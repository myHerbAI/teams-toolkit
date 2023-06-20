// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as os from "os";
import fs from "fs-extra";
import * as path from "path";
import { Container } from "typedi";
import { hooks } from "@feathersjs/hooks";
import {
  err,
  Func,
  FxError,
  Inputs,
  InputsWithProjectPath,
  ok,
  Platform,
  ProjectSettingsV3,
  Result,
  Settings,
  Stage,
  Tools,
  UserCancelError,
  Void,
  BuildFolderName,
  AppPackageFolderName,
} from "@microsoft/teamsfx-api";

import {
  AadConstants,
  AzureSolutionQuestionNames,
  SingleSignOnOptionItem,
  SPFxQuestionNames,
  ViewAadAppHelpLinkV5,
} from "../component/constants";
import { ObjectIsUndefinedError, InvalidInputError } from "./error";
import { setCurrentStage, TOOLS } from "./globalVars";
import { ConcurrentLockerMW } from "./middleware/concurrentLocker";
import { ContextInjectorMW } from "./middleware/contextInjector";
import { askNewEnvironment, EnvInfoLoaderMW_V3 } from "./middleware/envInfoLoaderV3";
import { ProjectSettingsLoaderMW } from "./middleware/projectSettingsLoader";
import { ErrorHandlerMW } from "./middleware/errorHandler";
import { QuestionModelMW, getQuestionsForCreateProjectV2 } from "./middleware/questionModel";
import { CoreHookContext, PreProvisionResForVS, VersionCheckRes } from "./types";
import { createContextV3, createDriverContext } from "../component/utils";
import { manifestUtils } from "../component/resource/appManifest/utils/ManifestUtils";
import "../component/driver/index";
import { UpdateAadAppDriver } from "../component/driver/aad/update";
import { UpdateAadAppArgs } from "../component/driver/aad/interface/updateAadAppArgs";
import { ValidateManifestDriver } from "../component/driver/teamsApp/validate";
import { ValidateAppPackageDriver } from "../component/driver/teamsApp/validateAppPackage";
import { ValidateManifestArgs } from "../component/driver/teamsApp/interfaces/ValidateManifestArgs";
import { ValidateAppPackageArgs } from "../component/driver/teamsApp/interfaces/ValidateAppPackageArgs";
import { DriverContext } from "../component/driver/interface/commonArgs";
import { coordinator } from "../component/coordinator";
import { CreateAppPackageDriver } from "../component/driver/teamsApp/createAppPackage";
import { CreateAppPackageArgs } from "../component/driver/teamsApp/interfaces/CreateAppPackageArgs";
import { EnvLoaderMW, EnvWriterMW } from "../component/middleware/envMW";
import { envUtil } from "../component/utils/envUtil";
import { DotenvParseOutput } from "dotenv";
import { checkActiveResourcePlugins, ProjectMigratorMWV3 } from "./middleware/projectMigratorV3";
import {
  containsUnsupportedFeature,
  getFeaturesFromAppDefinition,
} from "../component/resource/appManifest/utils/utils";
import { CoreTelemetryEvent, CoreTelemetryProperty } from "./telemetry";
import { isValidProjectV2, isValidProjectV3 } from "../common/projectSettingsHelper";
import {
  getVersionState,
  getProjectVersionFromPath,
  getTrackingIdFromPath,
} from "./middleware/utils/v3MigrationUtils";
import { QuestionMW } from "../component/middleware/questionMW";
import {
  getQuestionsForAddWebpart,
  getQuestionsForCreateAppPackage,
  getQuestionsForInit,
  getQuestionsForProvisionV3,
  getQuestionsForUpdateTeamsApp,
  getQuestionsForValidateManifest,
  getQuestionsForValidateAppPackage,
  getQuestionsForPreviewWithManifest,
} from "../component/question";
import { buildAadManifest } from "../component/driver/aad/utility/buildAadManifest";
import { MissingEnvInFileUserError } from "../component/driver/aad/error/missingEnvInFileError";
import { getDefaultString, getLocalizedString } from "../common/localizeUtils";
import { VersionSource, VersionState } from "../common/versionMetadata";
import { pathUtils } from "../component/utils/pathUtils";
import { isV3Enabled } from "../common/tools";
import { AddWebPartDriver } from "../component/driver/add/addWebPart";
import { AddWebPartArgs } from "../component/driver/add/interface/AddWebPartArgs";
import { FileNotFoundError, InvalidProjectError } from "../error/common";
import { CoreQuestionNames, validateAadManifestContainsPlaceholder } from "./question";
import { YamlFieldMissingError } from "../error/yml";
import { checkPermissionFunc, grantPermissionFunc, listCollaboratorFunc } from "./FxCore";
import { pathToFileURL } from "url";
import { VSCodeExtensionCommand } from "../common/constants";
import { Hub } from "../common/m365/constants";
import { LaunchHelper } from "../common/m365/launchHelper";
import { NoNeedUpgradeError } from "../error/upgrade";
import { SPFxVersionOptionIds } from "../component/resource/spfx/utils/question-helper";
import { settingsUtil } from "../component/utils/settingsUtil";

export class FxCoreV3Implement {
  tools: Tools;
  isFromSample?: boolean;
  settingsVersion?: string;

  constructor(tools: Tools) {
    this.tools = tools;
  }

  async dispatch<Inputs, ExecuteRes>(
    exec: (inputs: Inputs) => Promise<ExecuteRes>,
    inputs: Inputs
  ): Promise<ExecuteRes> {
    const methodName = exec.name as keyof FxCoreV3Implement;
    if (!this[methodName]) {
      throw new Error("no implement");
    }
    const method = this[methodName] as any as typeof exec;
    return await method.call(this, inputs);
  }

  async dispatchUserTask<Inputs, ExecuteRes>(
    exec: (func: Func, inputs: Inputs) => Promise<ExecuteRes>,
    func: Func,
    inputs: Inputs
  ): Promise<ExecuteRes> {
    const methodName = exec.name as keyof FxCoreV3Implement;
    if (!this[methodName]) {
      throw new Error("no implement");
    }
    const method = this[methodName] as any as typeof exec;
    return await method.call(this, func, inputs);
  }

  @hooks([ErrorHandlerMW, QuestionMW(getQuestionsForCreateProjectV2), ContextInjectorMW])
  async createProject(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<string, FxError>> {
    if (!ctx) {
      return err(new ObjectIsUndefinedError("ctx for createProject"));
    }
    setCurrentStage(Stage.create);
    inputs.stage = Stage.create;
    const context = createContextV3();
    if (inputs.teamsAppFromTdp) {
      // should never happen as we do same check on Developer Portal.
      if (containsUnsupportedFeature(inputs.teamsAppFromTdp)) {
        return err(InvalidInputError("Teams app contains unsupported features"));
      } else {
        context.telemetryReporter.sendTelemetryEvent(CoreTelemetryEvent.CreateFromTdpStart, {
          [CoreTelemetryProperty.TdpTeamsAppFeatures]: getFeaturesFromAppDefinition(
            inputs.teamsAppFromTdp
          ).join(","),
          [CoreTelemetryProperty.TdpTeamsAppId]: inputs.teamsAppFromTdp.teamsAppId,
        });
      }
    }
    const res = await coordinator.create(context, inputs as InputsWithProjectPath);
    if (res.isErr()) return err(res.error);
    ctx.projectSettings = context.projectSetting;
    inputs.projectPath = context.projectPath;
    return ok(inputs.projectPath!);
  }

  @hooks([
    ErrorHandlerMW,
    QuestionMW((inputs) => {
      return getQuestionsForInit("infra", inputs);
    }),
  ])
  async initInfra(inputs: Inputs): Promise<Result<undefined, FxError>> {
    const res = await coordinator.initInfra(createContextV3(), inputs);
    return res;
  }

  @hooks([
    ErrorHandlerMW,
    QuestionMW((inputs) => {
      return getQuestionsForInit("debug", inputs);
    }),
  ])
  async initDebug(inputs: Inputs): Promise<Result<undefined, FxError>> {
    const res = await coordinator.initDebug(createContextV3(), inputs);
    return res;
  }

  @hooks([
    ErrorHandlerMW,
    ProjectMigratorMWV3,
    QuestionMW(getQuestionsForProvisionV3),
    EnvLoaderMW(false),
    ConcurrentLockerMW,
    ContextInjectorMW,
    EnvWriterMW,
  ])
  async provisionResources(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<Void, FxError>> {
    setCurrentStage(Stage.provision);
    inputs.stage = Stage.provision;
    const context = createDriverContext(inputs);
    try {
      const res = await coordinator.provision(context, inputs as InputsWithProjectPath);
      if (res.isOk()) {
        ctx!.envVars = res.value;
        return ok(Void);
      } else {
        // for partial success scenario, output is set in inputs object
        ctx!.envVars = inputs.envVars;
        return err(res.error);
      }
    } finally {
      //reset subscription
      try {
        await TOOLS.tokenProvider.azureAccountProvider.setSubscription("");
      } catch (e) {}
    }
  }

  @hooks([
    ErrorHandlerMW,
    ProjectMigratorMWV3,
    EnvLoaderMW(false),
    ConcurrentLockerMW,
    ContextInjectorMW,
    EnvWriterMW,
  ])
  async deployArtifacts(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<Void, FxError>> {
    setCurrentStage(Stage.deploy);
    inputs.stage = Stage.deploy;
    const context = createDriverContext(inputs);
    const res = await coordinator.deploy(context, inputs as InputsWithProjectPath);
    if (res.isOk()) {
      ctx!.envVars = res.value;
      return ok(Void);
    } else {
      // for partial success scenario, output is set in inputs object
      ctx!.envVars = inputs.envVars;
      return err(res.error);
    }
  }

  @hooks([
    ErrorHandlerMW,
    ProjectMigratorMWV3,
    QuestionModelMW,
    EnvLoaderMW(true, true),
    ConcurrentLockerMW,
    ContextInjectorMW,
  ])
  async deployAadManifest(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<Void, FxError>> {
    setCurrentStage(Stage.deployAad);
    inputs.stage = Stage.deployAad;
    const updateAadClient = Container.get<UpdateAadAppDriver>("aadApp/update");
    // In V3, the aad.template.json exist at .fx folder, and output to root build folder.
    const manifestTemplatePath: string = inputs[CoreQuestionNames.AadAppManifestFilePath];
    if (!(await fs.pathExists(manifestTemplatePath))) {
      return err(new FileNotFoundError("deployAadManifest", manifestTemplatePath));
    }
    let manifestOutputPath: string = manifestTemplatePath;
    if (inputs.env && !(await validateAadManifestContainsPlaceholder(undefined, inputs))) {
      await fs.ensureDir(path.join(inputs.projectPath!, "build"));
      manifestOutputPath = path.join(
        inputs.projectPath!,
        "build",
        `aad.manifest.${inputs.env}.json`
      );
    }
    const inputArgs: UpdateAadAppArgs = {
      manifestPath: manifestTemplatePath,
      outputFilePath: manifestOutputPath,
    };
    const contextV3: DriverContext = createDriverContext(inputs);
    const res = await updateAadClient.run(inputArgs, contextV3);
    if (res.isErr()) {
      if (res.error instanceof MissingEnvInFileUserError) {
        res.error.message += " " + getDefaultString("error.UpdateAadManifest.MissingEnvHint"); // hint users can run provision/debug to create missing env for our project template
        if (res.error.displayMessage) {
          res.error.displayMessage +=
            " " + getLocalizedString("error.UpdateAadManifest.MissingEnvHint");
        }
      }
      return err(res.error);
    }
    if (contextV3.platform === Platform.CLI) {
      const msg = getLocalizedString("core.deploy.aadManifestOnCLISuccessNotice");
      contextV3.ui!.showMessage("info", msg, false);
    } else {
      const msg = getLocalizedString("core.deploy.aadManifestSuccessNotice");
      contextV3
        .ui!.showMessage("info", msg, false, getLocalizedString("core.deploy.aadManifestLearnMore"))
        .then((result) => {
          const userSelected = result.isOk() ? result.value : undefined;
          if (userSelected === getLocalizedString("core.deploy.aadManifestLearnMore")) {
            contextV3.ui!.openUrl(ViewAadAppHelpLinkV5);
          }
        });
    }
    return ok(Void);
  }

  @hooks([
    ErrorHandlerMW,
    ProjectMigratorMWV3,
    EnvLoaderMW(false),
    ConcurrentLockerMW,
    ContextInjectorMW,
    EnvWriterMW,
  ])
  async publishApplication(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<Void, FxError>> {
    setCurrentStage(Stage.publish);
    inputs.stage = Stage.publish;
    const context = createDriverContext(inputs);
    const res = await coordinator.publish(context, inputs as InputsWithProjectPath);
    if (res.isOk()) {
      ctx!.envVars = res.value;
      return ok(Void);
    } else {
      // for partial success scenario, output is set in inputs object
      ctx!.envVars = inputs.envVars;
      return err(res.error);
    }
  }

  @hooks([
    ErrorHandlerMW,
    ProjectMigratorMWV3,
    QuestionMW(getQuestionsForUpdateTeamsApp),
    EnvLoaderMW(true),
    ConcurrentLockerMW,
    ContextInjectorMW,
    EnvWriterMW,
  ])
  async deployTeamsManifest(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<Void, FxError>> {
    inputs.manifestTemplatePath = inputs[CoreQuestionNames.TeamsAppManifestFilePath] as string;
    const context = createContextV3(ctx?.projectSettings as ProjectSettingsV3);
    const component = Container.get("app-manifest") as any;
    const res = await component.deployV3(context, inputs as InputsWithProjectPath);
    if (res.isOk()) {
      ctx!.envVars = envUtil.map2object(res.value);
    }
    return res;
  }

  @hooks([ErrorHandlerMW, ProjectMigratorMWV3, EnvLoaderMW(false), ConcurrentLockerMW])
  async executeUserTask(
    func: Func,
    inputs: Inputs,
    ctx?: CoreHookContext
  ): Promise<Result<any, FxError>> {
    let res: Result<any, FxError> = ok(undefined);
    const context = createDriverContext(inputs);
    if (func.method === "addSso") {
      // used in v3 only in VS
      inputs.stage = Stage.addFeature;
      inputs[AzureSolutionQuestionNames.Features] = SingleSignOnOptionItem.id;
      const component = Container.get("sso") as any;
      res = await component.add(context, inputs as InputsWithProjectPath);
    }
    return res;
  }

  @hooks([
    ErrorHandlerMW,
    QuestionMW(getQuestionsForAddWebpart),
    ProjectMigratorMWV3,
    ConcurrentLockerMW,
  ])
  async addWebpart(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<Void, FxError>> {
    const driver: AddWebPartDriver = Container.get<AddWebPartDriver>("spfx/add");
    const args: AddWebPartArgs = {
      manifestPath: inputs[SPFxQuestionNames.ManifestPath],
      localManifestPath: inputs[SPFxQuestionNames.LocalManifestPath],
      spfxFolder: inputs[SPFxQuestionNames.SPFxFolder],
      webpartName: inputs[SPFxQuestionNames.WebPartName],
      spfxPackage: SPFxVersionOptionIds.installLocally,
    };
    const contextV3: DriverContext = createDriverContext(inputs);
    return await driver.run(args, contextV3);
  }

  @hooks([ErrorHandlerMW, ConcurrentLockerMW, ContextInjectorMW])
  async publishInDeveloperPortal(
    inputs: Inputs,
    ctx?: CoreHookContext
  ): Promise<Result<Void, FxError>> {
    setCurrentStage(Stage.publishInDeveloperPortal);
    inputs.stage = Stage.publishInDeveloperPortal;
    const context = createContextV3();
    return await coordinator.publishInDeveloperPortal(context, inputs as InputsWithProjectPath);
  }

  @hooks([
    ErrorHandlerMW,
    ProjectMigratorMWV3,
    QuestionModelMW,
    EnvLoaderMW(false, true),
    ProjectSettingsLoaderMW, // this middleware is for v2 and will be removed after v3 refactor
    ConcurrentLockerMW,
    ContextInjectorMW,
    EnvWriterMW,
  ])
  async grantPermission(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<any, FxError>> {
    return grantPermissionFunc(inputs, ctx);
  }

  @hooks([
    ErrorHandlerMW,
    ProjectMigratorMWV3,
    QuestionModelMW,
    EnvLoaderMW(false, true),
    ProjectSettingsLoaderMW, // this middleware is for v2 and will be removed after v3 refactor
    ConcurrentLockerMW,
    ContextInjectorMW,
    EnvWriterMW,
  ])
  async checkPermission(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<any, FxError>> {
    return checkPermissionFunc(inputs, ctx);
  }

  @hooks([
    ErrorHandlerMW,
    ProjectMigratorMWV3,
    QuestionModelMW,
    EnvLoaderMW(false, true),
    ProjectSettingsLoaderMW, // this middleware is for v2 and will be removed after v3 refactor
    ConcurrentLockerMW,
    ContextInjectorMW,
    EnvWriterMW,
  ])
  async listCollaborator(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<any, FxError>> {
    return listCollaboratorFunc(inputs, ctx);
  }

  async getSettings(inputs: InputsWithProjectPath): Promise<Result<Settings, FxError>> {
    return settingsUtil.readSettings(inputs.projectPath);
  }

  @hooks([ErrorHandlerMW, EnvLoaderMW(true), ContextInjectorMW])
  async getDotEnv(
    inputs: InputsWithProjectPath,
    ctx?: CoreHookContext
  ): Promise<Result<DotenvParseOutput | undefined, FxError>> {
    return ok(ctx?.envVars);
  }

  async phantomMigrationV3(inputs: Inputs): Promise<Result<Void, FxError>> {
    // If the project is invalid or upgraded, the ProjectMigratorMWV3 will not take action.
    // Check invaliad/upgraded project here before call ProjectMigratorMWV3
    const projectPath = (inputs.projectPath as string) || "";
    const version = await getProjectVersionFromPath(projectPath);

    if (version.source === VersionSource.teamsapp) {
      return err(new NoNeedUpgradeError());
    } else if (version.source === VersionSource.projectSettings) {
      const isValid = await checkActiveResourcePlugins(projectPath);
      if (!isValid) {
        return err(new InvalidProjectError());
      }
    }
    if (version.source === VersionSource.unknown) {
      return err(new InvalidProjectError());
    }
    return await this.innerMigrationV3(inputs);
  }

  @hooks([ErrorHandlerMW, ProjectMigratorMWV3])
  async innerMigrationV3(inputs: Inputs): Promise<Result<Void, FxError>> {
    return ok(Void);
  }

  @hooks([ErrorHandlerMW])
  async projectVersionCheck(inputs: Inputs): Promise<Result<VersionCheckRes, FxError>> {
    const projectPath = (inputs.projectPath as string) || "";
    if (isValidProjectV3(projectPath) || isValidProjectV2(projectPath)) {
      const versionInfo = await getProjectVersionFromPath(projectPath);
      if (!versionInfo.version) {
        return err(new InvalidProjectError());
      }
      const trackingId = await getTrackingIdFromPath(projectPath);
      let isSupport: VersionState;
      if (!isV3Enabled()) {
        if (versionInfo.source === VersionSource.projectSettings) {
          isSupport = VersionState.compatible;
        } else {
          isSupport = VersionState.unsupported;
        }
      } else {
        isSupport = getVersionState(versionInfo);
        // if the project is upgradeable, check whether the project is valid and invalid project should not show upgrade option.
        if (isSupport === VersionState.upgradeable) {
          if (!(await checkActiveResourcePlugins(projectPath))) {
            return err(new InvalidProjectError());
          }
        }
      }
      return ok({
        currentVersion: versionInfo.version,
        trackingId,
        isSupport,
        versionSource: VersionSource[versionInfo.source],
      });
    } else {
      return err(new InvalidProjectError());
    }
  }

  @hooks([
    ErrorHandlerMW,
    ProjectMigratorMWV3,
    EnvLoaderMW(false),
    ConcurrentLockerMW,
    ContextInjectorMW,
  ])
  async preProvisionForVS(
    inputs: Inputs,
    ctx?: CoreHookContext
  ): Promise<Result<PreProvisionResForVS, FxError>> {
    const context = createDriverContext(inputs);
    return coordinator.preProvisionForVS(context, inputs as InputsWithProjectPath);
  }

  @hooks([
    ErrorHandlerMW,
    ProjectMigratorMWV3,
    EnvLoaderMW(false),
    ConcurrentLockerMW,
    ContextInjectorMW,
  ])
  async preCheckYmlAndEnvForVS(
    inputs: Inputs,
    ctx?: CoreHookContext
  ): Promise<Result<Void, FxError>> {
    const context = createDriverContext(inputs);
    const result = await coordinator.preCheckYmlAndEnvForVS(
      context,
      inputs as InputsWithProjectPath
    );
    return result;
  }

  @hooks([ErrorHandlerMW, ConcurrentLockerMW, ContextInjectorMW])
  async createEnv(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<Void, FxError>> {
    if (!ctx || !inputs.projectPath)
      return err(new ObjectIsUndefinedError("createEnv input stuff"));

    const createEnvCopyInput = await askNewEnvironment(ctx!, inputs);
    if (
      !createEnvCopyInput ||
      !createEnvCopyInput.targetEnvName ||
      !createEnvCopyInput.sourceEnvName
    ) {
      return err(UserCancelError);
    }

    return this.createEnvCopyV3(
      createEnvCopyInput.targetEnvName,
      createEnvCopyInput.sourceEnvName,
      inputs.projectPath
    );
  }

  async createEnvCopyV3(
    targetEnvName: string,
    sourceEnvName: string,
    projectPath: string
  ): Promise<Result<Void, FxError>> {
    let res = await pathUtils.getEnvFilePath(projectPath, sourceEnvName);
    if (res.isErr()) return err(res.error);
    const sourceDotEnvFile = res.value;

    res = await pathUtils.getEnvFilePath(projectPath, targetEnvName);
    if (res.isErr()) return err(res.error);
    const targetDotEnvFile = res.value;
    if (!sourceDotEnvFile || !targetDotEnvFile)
      return err(new YamlFieldMissingError("environmentFolderPath"));
    if (!(await fs.pathExists(sourceDotEnvFile)))
      return err(new FileNotFoundError("createEnvCopyV3", sourceDotEnvFile));
    const source = await fs.readFile(sourceDotEnvFile);
    const writeStream = fs.createWriteStream(targetDotEnvFile);
    source
      .toString()
      .split(/\r?\n/)
      .forEach((line) => {
        const reg = /^([a-zA-Z_][a-zA-Z0-9_]*=)/g;
        const match = reg.exec(line);
        if (match) {
          if (match[1].startsWith("TEAMSFX_ENV=")) {
            writeStream.write(`TEAMSFX_ENV=${targetEnvName}${os.EOL}`);
          } else {
            writeStream.write(`${match[1]}${os.EOL}`);
          }
        } else {
          writeStream.write(`${line.trim()}${os.EOL}`);
        }
      });

    writeStream.end();
    return ok(Void);
  }

  @hooks([ErrorHandlerMW, ProjectMigratorMWV3, EnvLoaderMW(false), ConcurrentLockerMW])
  async buildAadManifest(inputs: Inputs): Promise<Result<Void, FxError>> {
    const manifestTemplatePath: string = inputs.AAD_MANIFEST_FILE
      ? inputs.AAD_MANIFEST_FILE
      : path.join(inputs.projectPath!, AadConstants.DefaultTemplateFileName);
    if (!(await fs.pathExists(manifestTemplatePath))) {
      return err(new FileNotFoundError("buildAadManifest", manifestTemplatePath));
    }
    await fs.ensureDir(path.join(inputs.projectPath!, "build"));
    const manifestOutputPath: string = path.join(
      inputs.projectPath!,
      "build",
      `aad.${inputs.env}.json`
    );
    const contextV3: DriverContext = createDriverContext(inputs);
    await buildAadManifest(contextV3, manifestTemplatePath, manifestOutputPath);
    return ok(Void);
  }

  @hooks([
    ErrorHandlerMW,
    QuestionMW(getQuestionsForValidateManifest),
    ConcurrentLockerMW,
    EnvLoaderMW(true),
  ])
  async validateManifest(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<any, FxError>> {
    setCurrentStage(Stage.validateApplication);
    inputs.stage = Stage.validateApplication;

    const context: DriverContext = createDriverContext(inputs);

    const teamsAppManifestFilePath = inputs?.[CoreQuestionNames.TeamsAppManifestFilePath] as string;
    const args: ValidateManifestArgs = {
      manifestPath: teamsAppManifestFilePath,
      showMessage: inputs?.showMessage != undefined ? inputs.showMessage : true,
    };
    const driver: ValidateManifestDriver = Container.get("teamsApp/validateManifest");
    const result = await driver.run(args, context);
    return result;
  }

  @hooks([ErrorHandlerMW, QuestionMW(getQuestionsForValidateAppPackage), ConcurrentLockerMW])
  async validateAppPackage(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<any, FxError>> {
    setCurrentStage(Stage.validateApplication);
    inputs.stage = Stage.validateApplication;

    const context: DriverContext = createDriverContext(inputs);
    const teamsAppPackageFilePath = inputs?.[CoreQuestionNames.TeamsAppPackageFilePath] as string;
    const args: ValidateAppPackageArgs = {
      appPackagePath: teamsAppPackageFilePath,
      showMessage: true,
    };
    const driver: ValidateAppPackageDriver = Container.get("teamsApp/validateAppPackage");
    return await driver.run(args, context);
  }

  @hooks([
    ErrorHandlerMW,
    QuestionMW(getQuestionsForCreateAppPackage),
    EnvLoaderMW(true),
    ConcurrentLockerMW,
  ])
  async createAppPackage(inputs: Inputs, ctx?: CoreHookContext): Promise<Result<any, FxError>> {
    setCurrentStage(Stage.createAppPackage);
    inputs.stage = Stage.createAppPackage;

    const context: DriverContext = createDriverContext(inputs);

    const teamsAppManifestFilePath = inputs?.[CoreQuestionNames.TeamsAppManifestFilePath] as string;

    const driver: CreateAppPackageDriver = Container.get("teamsApp/zipAppPackage");
    const args: CreateAppPackageArgs = {
      manifestPath: teamsAppManifestFilePath,
      outputZipPath:
        inputs[CoreQuestionNames.OutputZipPathParamName] ??
        `${inputs.projectPath}/${AppPackageFolderName}/${BuildFolderName}/appPackage.${process.env.TEAMSFX_ENV}.zip`,
      outputJsonPath:
        inputs[CoreQuestionNames.OutputManifestParamName] ??
        `${inputs.projectPath}/${AppPackageFolderName}/${BuildFolderName}/manifest.${process.env.TEAMSFX_ENV}.json`,
    };
    const result = await driver.run(args, context);
    if (context.platform === Platform.VSCode) {
      if (result.isOk()) {
        const isWindows = process.platform === "win32";
        let zipFileName = args.outputZipPath;
        if (!path.isAbsolute(zipFileName)) {
          zipFileName = path.join(context.projectPath, zipFileName);
        }
        let builtSuccess = getLocalizedString(
          "plugins.appstudio.buildSucceedNotice.fallback",
          zipFileName
        );
        if (isWindows) {
          const folderLink = pathToFileURL(path.dirname(zipFileName));
          const appPackageLink = `${VSCodeExtensionCommand.openFolder}?%5B%22${folderLink}%22%5D`;
          builtSuccess = getLocalizedString("plugins.appstudio.buildSucceedNotice", appPackageLink);
        }
        context.ui?.showMessage("info", builtSuccess, false);
      }
    }
    return result;
  }

  @hooks([
    ErrorHandlerMW,
    QuestionMW(getQuestionsForPreviewWithManifest),
    EnvLoaderMW(false),
    ConcurrentLockerMW,
  ])
  async previewWithManifest(
    inputs: Inputs,
    ctx?: CoreHookContext
  ): Promise<Result<string, FxError>> {
    setCurrentStage(Stage.previewWithManifest);
    inputs.stage = Stage.previewWithManifest;

    const hub = inputs[CoreQuestionNames.M365Host] as Hub;
    const manifestFilePath = inputs[CoreQuestionNames.TeamsAppManifestFilePath] as string;

    const manifestRes = await manifestUtils.getManifestV3(manifestFilePath, {}, false, false);
    if (manifestRes.isErr()) {
      return err(manifestRes.error);
    }

    const teamsAppId = manifestRes.value.id;
    const capabilities = manifestUtils._getCapabilities(manifestRes.value);

    const launchHelper = new LaunchHelper(
      this.tools.tokenProvider.m365TokenProvider,
      this.tools.logProvider
    );
    const result = await launchHelper.getLaunchUrl(hub, teamsAppId, capabilities);
    return result;
  }
}
