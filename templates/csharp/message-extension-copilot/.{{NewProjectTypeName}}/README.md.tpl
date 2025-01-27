# Welcome to Teams Toolkit!

## Quick Start

> **Prerequisites**
>
> To run the app template in your local dev machine, you will need:
>
> - [Visual Studio 2022](https://aka.ms/vs) 17.8 or higher and [install Teams Toolkit](https://aka.ms/install-teams-toolkit-vs).
{{^enableTestToolByDefault}}
> - A [Microsoft 365 account for development](https://docs.microsoft.com/microsoftteams/platform/toolkit/accounts)
{{/enableTestToolByDefault}}
> - [Microsoft 365 Copilot license](https://learn.microsoft.com/microsoft-365-copilot/extensibility/prerequisites#prerequisites)

{{#enableTestToolByDefault}}
1. Press F5 to start debugging which launches your app in Teams App Test Tool using a web browser.
2. You can search NuGet package from compose message area, or from the command box.
{{/enableTestToolByDefault}}
{{^enableTestToolByDefault}}
1. In the debug dropdown menu, select Dev Tunnels > Create a Tunnel (set authentication type to Public) or select an existing public dev tunnel
</br>![image](https://raw.githubusercontent.com/OfficeDev/TeamsFx/dev/docs/images/visualstudio/debug/create-devtunnel-button.png).
2. Right-click the '{{NewProjectTypeName}}' project and select Teams Toolkit > Prepare Teams App Dependencies
3. If prompted, sign in with a Microsoft 365 account for the Teams organization you want
   to install the app to.
4. Press F5, or select Debug > Start Debugging menu in Visual Studio to start your app
</br>![image](https://raw.githubusercontent.com/OfficeDev/TeamsFx/dev/docs/images/visualstudio/debug/debug-button.png)
5. In the launched browser, select the Add button to load the app in Teams.
6. You can search for NuGet package from the message input field or the command box.
{{/enableTestToolByDefault}}

> For local debugging using Teams Toolkit CLI, you need to do some extra steps described in [Set up your Teams Toolkit CLI for local debugging](https://aka.ms/teamsfx-cli-debugging).

{{^enableTestToolByDefault}}
## Debug in Test Tool
Teams App Test Tool allows developers test and debug bots locally without needing Microsoft 365 accounts, development tunnels, or Teams app and bot registration. See https://aka.ms/teams-toolkit-vs-test-tool for more details.
{{/enableTestToolByDefault}}

## Run the app on other platforms

The Teams app can run in other platforms like Outlook and Microsoft 365 app. See https://aka.ms/vs-ttk-debug-multi-profiles for more details.

## Get more info

- [Extend Microsoft 365 Copilot](https://aka.ms/teamsfx-copilot-plugin)

## Report an issue

Select Visual Studio > Help > Send Feedback > Report a Problem.
Or, create an issue directly in our GitHub repository:
https://github.com/OfficeDev/TeamsFx/issues
