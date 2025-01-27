// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  SystemError,
  SystemErrorOptions,
  UserError,
  UserErrorOptions,
} from "@microsoft/teamsfx-api";
import { getDefaultString, getLocalizedString } from "../common/localizeUtils";
import { ErrorCategory } from "./types";
import { Constants } from "../component/driver/teamsApp/constants";
import { matchDnsError } from "./common";

export class DeveloperPortalAPIFailedSystemError extends SystemError {
  constructor(
    e: any,
    correlationId: string,
    apiName: string,
    extraData: string,
    displayMessage?: string
  ) {
    if (!displayMessage) {
      displayMessage = matchDnsError(e.message);
    }
    const errorOptions: SystemErrorOptions = {
      source: Constants.PLUGIN_NAME,
      error: e,
      message: getDefaultString(
        // github issue workflow uses this template for matching. Please send a heads-up to the owner of workflows if you want to change it.
        "error.appstudio.apiFailed.telemetry",
        e.name,
        e.message,
        apiName,
        correlationId,
        extraData
      ),
      displayMessage: displayMessage || getLocalizedString("error.appstudio.apiFailed"),
      categories: [ErrorCategory.Unhandled, apiName],
    };
    super(errorOptions);
  }
}

export class DeveloperPortalAPIFailedUserError extends UserError {
  constructor(
    e: any,
    correlationId: string,
    apiName: string,
    extraData: string,
    displayMessage?: string,
    helpLink?: string
  ) {
    const errorOptions: UserErrorOptions = {
      source: Constants.PLUGIN_NAME,
      error: e,
      message: getDefaultString(
        // github issue workflow uses this template for matching. Please send a heads-up to the owner of workflows if you want to change it.
        "error.appstudio.apiFailed.telemetry",
        e.name,
        e.message,
        apiName,
        correlationId,
        extraData
      ),
      displayMessage: displayMessage || getLocalizedString("error.appstudio.apiFailed"),
      categories: [ErrorCategory.Unhandled, apiName],
      helpLink: helpLink,
    };
    super(errorOptions);
  }
}

export class CheckSideloadingPermissionFailedError extends SystemError {
  constructor(e: any, correlationId: string, apiName: string, extraData: string) {
    const errorOptions: SystemErrorOptions = {
      source: "M365Account",
      error: e,
      message: getDefaultString(
        "error.appstudio.apiFailed.telemetry",
        e.name,
        e.message,
        apiName,
        correlationId,
        extraData
      ),
      categories: [ErrorCategory.External],
    };
    super(errorOptions);
  }
}

export class InvalidFileOutsideOfTheDirectotryError extends UserError {
  constructor(filePath: string) {
    const errorOptions: UserErrorOptions = {
      source: Constants.PLUGIN_NAME,
      message: getDefaultString("error.teamsApp.createAppPackage.invalidFile", filePath),
      displayMessage: getLocalizedString("error.teamsApp.createAppPackage.invalidFile", filePath),
      categories: [ErrorCategory.External],
    };
    super(errorOptions);
  }
}

export class AppIdNotExist extends UserError {
  constructor(appId: string, source?: string) {
    super({
      source: source || "core",
      name: AppIdNotExist.name,
      message: getDefaultString("error.core.appIdNotExist", appId),
      displayMessage: getLocalizedString("error.core.appIdNotExist", appId),
    });
  }
}
