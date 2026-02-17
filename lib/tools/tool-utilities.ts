/**
 * Utility Functions for Common Tool Operations
 * Pre-built functions for frequently used tool combinations
 */

import { ToolIntegrationManager, ToolExecutionContext } from "./tool-integration-system";

export class ToolUtilities {
  constructor(private toolManager: ToolIntegrationManager) {}

  /**
   * Send an email with optional document attachment
   */
  async sendEmailWithDoc(
    context: ToolExecutionContext,
    params: {
      to: string;
      subject: string;
      body: string;
      docTitle?: string;
      docContent?: string;
    }
  ) {
    let emailBody = params.body;

    // Create document if content provided
    if (params.docTitle && params.docContent) {
      const docResult = await this.toolManager.executeTool(
        "googledocs.create",
        {
          title: params.docTitle,
          text_content: params.docContent,
        },
        context
      );

      if (docResult.success && docResult.output?.documentUrl) {
        emailBody += `\n\nDocument: ${docResult.output.documentUrl}`;
      }
    }

    // Send email
    return await this.toolManager.executeTool(
      "gmail.send",
      {
        recipient: params.to,
        subject: params.subject,
        body: emailBody,
      },
      context
    );
  }

  /**
   * Search and summarize emails
   */
  async searchAndSummarizeEmails(
    context: ToolExecutionContext,
    query: string,
    maxResults: number = 10
  ) {
    const searchResult = await this.toolManager.executeTool(
      "gmail.search",
      { query, max_results: maxResults },
      context
    );

    if (!searchResult.success) {
      return searchResult;
    }

    // Create summary document
    const emails = searchResult.output?.emails || [];
    const summary = emails
      .map(
        (email: any, idx: number) =>
          `${idx + 1}. From: ${email.from}\n   Subject: ${email.subject}\n   Date: ${email.date}\n`
      )
      .join("\n");

    return await this.toolManager.executeTool(
      "googledocs.create",
      {
        title: `Email Search Results: ${query}`,
        text_content: summary,
      },
      context
    );
  }

  /**
   * Create meeting with calendar event and notification
   */
  async scheduleMeeting(
    context: ToolExecutionContext,
    params: {
      title: string;
      startTime: Date;
      endTime: Date;
      attendees: string[];
      location?: string;
      notifyVia?: "email" | "sms" | "slack";
      notifyChannel?: string;
    }
  ) {
    // Create calendar event
    const eventResult = await this.toolManager.executeTool(
      "googlecalendar.create",
      {
        summary: params.title,
        start: { dateTime: params.startTime.toISOString() },
        end: { dateTime: params.endTime.toISOString() },
        attendees: params.attendees.map((email) => ({ email })),
        location: params.location,
      },
      context
    );

    if (!eventResult.success) {
      return eventResult;
    }

    // Send notifications
    const eventUrl = eventResult.output?.htmlLink;
    const message = `Meeting scheduled: ${params.title}\nTime: ${params.startTime.toLocaleString()}\nLink: ${eventUrl}`;

    if (params.notifyVia === "email") {
      await Promise.all(
        params.attendees.map((email) =>
          this.toolManager.executeTool(
            "gmail.send",
            {
              recipient: email,
              subject: `Meeting Scheduled: ${params.title}`,
              body: message,
            },
            context
          )
        )
      );
    } else if (params.notifyVia === "sms" && params.attendees.length > 0) {
      await this.toolManager.executeTool(
        "twilio.send_sms",
        {
          to: params.attendees[0], // Assuming phone number
          body: message,
        },
        context
      );
    } else if (params.notifyVia === "slack" && params.notifyChannel) {
      await this.toolManager.executeTool(
        "slack.send_message",
        {
          channel: params.notifyChannel,
          text: message,
        },
        context
      );
    }

    return eventResult;
  }

  /**
   * Backup emails to Google Drive
   */
  async backupEmailsToSheet(
    context: ToolExecutionContext,
    query: string,
    sheetName: string = "Email Backup"
  ) {
    // Search emails
    const searchResult = await this.toolManager.executeTool(
      "gmail.search",
      { query, max_results: 100 },
      context
    );

    if (!searchResult.success) {
      return searchResult;
    }

    const emails = searchResult.output?.emails || [];

    // Create spreadsheet with email data
    const headers = ["From", "Subject", "Date", "Snippet"];
    const rows = emails.map((email: any) => [
      email.from,
      email.subject,
      email.date,
      email.snippet,
    ]);

    return await this.toolManager.executeTool(
      "googlesheets.create",
      {
        title: sheetName,
        data: [headers, ...rows],
      },
      context
    );
  }

  /**
   * Create project repository and task tracker
   */
  async initializeProject(
    context: ToolExecutionContext,
    params: {
      projectName: string;
      description: string;
      githubOrg?: string;
      notionDatabase?: string;
      tasks?: Array<{ title: string; description: string }>;
    }
  ) {
    const results: any = {};

    // Create GitHub repository
    if (params.githubOrg) {
      const repoResult = await this.toolManager.executeTool(
        "github.create_repo",
        {
          name: params.projectName,
          description: params.description,
          org: params.githubOrg,
        },
        context
      );
      results.github = repoResult;
    }

    // Create Notion project page
    if (params.notionDatabase) {
      const notionResult = await this.toolManager.executeTool(
        "notion.create_page",
        {
          parent: { database_id: params.notionDatabase },
          properties: {
            Name: { title: [{ text: { content: params.projectName } }] },
            Description: { rich_text: [{ text: { content: params.description } }] },
          },
        },
        context
      );
      results.notion = notionResult;

      // Create tasks as issues
      if (params.tasks) {
        for (const task of params.tasks) {
          await this.toolManager.executeTool(
            "github.create_issue",
            {
              title: task.title,
              body: task.description,
            },
            context
          );
        }
      }
    }

    return { success: true, output: results };
  }

  /**
   * Send scheduled SMS reminders
   */
  async scheduleReminder(
    context: ToolExecutionContext,
    params: {
      phone: string;
      message: string;
      reminderTime: Date;
      createCalendarEvent?: boolean;
    }
  ) {
    // Create calendar event for reminder
    if (params.createCalendarEvent) {
      await this.toolManager.executeTool(
        "googlecalendar.create",
        {
          summary: "SMS Reminder",
          start: { dateTime: params.reminderTime.toISOString() },
          end: {
            dateTime: new Date(
              params.reminderTime.getTime() + 5 * 60000
            ).toISOString(),
          },
          description: params.message,
        },
        context
      );
    }

    // Schedule SMS
    return await this.toolManager.executeTool(
      "twilio.send_sms",
      {
        to: params.phone,
        body: params.message,
        schedule_time: params.reminderTime.toISOString(),
      },
      context
    );
  }

  /**
   * Research and compile report
   */
  async researchAndCompile(
    context: ToolExecutionContext,
    params: {
      topic: string;
      sources?: string[];
      outputFormat?: "doc" | "sheet" | "notion";
      shareVia?: "email" | "slack";
      shareTo?: string;
    }
  ) {
    // Search for information
    const searchResult = await this.toolManager.executeTool(
      "exa.search",
      {
        query: params.topic,
        num_results: 10,
      },
      context
    );

    if (!searchResult.success) {
      return searchResult;
    }

    const results = searchResult.output?.results || [];
    const content = results
      .map(
        (r: any, idx: number) =>
          `## Source ${idx + 1}: ${r.title}\n${r.url}\n\n${r.text}\n\n`
      )
      .join("\n");

    // Create document based on format
    let outputResult;
    if (params.outputFormat === "doc") {
      outputResult = await this.toolManager.executeTool(
        "googledocs.create",
        {
          title: `Research: ${params.topic}`,
          text_content: content,
        },
        context
      );
    } else if (params.outputFormat === "sheet") {
      const rows = results.map((r: any) => [r.title, r.url, r.text]);
      outputResult = await this.toolManager.executeTool(
        "googlesheets.create",
        {
          title: `Research: ${params.topic}`,
          data: [["Title", "URL", "Summary"], ...rows],
        },
        context
      );
    } else if (params.outputFormat === "notion") {
      outputResult = await this.toolManager.executeTool(
        "notion.create_page",
        {
          properties: {
            Name: { title: [{ text: { content: `Research: ${params.topic}` } }] },
          },
          children: [
            {
              type: "paragraph",
              paragraph: { rich_text: [{ text: { content } }] },
            },
          ],
        },
        context
      );
    }

    // Share the document
    if (outputResult?.success && params.shareVia && params.shareTo) {
      const docUrl = outputResult.output?.documentUrl || outputResult.output?.url;
      const message = `Research report ready: ${params.topic}\n${docUrl}`;

      if (params.shareVia === "email") {
        await this.toolManager.executeTool(
          "gmail.send",
          {
            recipient: params.shareTo,
            subject: `Research Report: ${params.topic}`,
            body: message,
          },
          context
        );
      } else if (params.shareVia === "slack") {
        await this.toolManager.executeTool(
          "slack.send_message",
          {
            channel: params.shareTo,
            text: message,
          },
          context
        );
      }
    }

    return outputResult;
  }

  /**
   * Deploy to Vercel and notify team
   */
  async deployAndNotify(
    context: ToolExecutionContext,
    params: {
      projectName: string;
      githubRepo?: string;
      notifyChannel?: string;
      createDeploymentDoc?: boolean;
    }
  ) {
    // Deploy to Vercel
    const deployResult = await this.toolManager.executeTool(
      "vercel.deploy",
      {
        name: params.projectName,
        gitSource: params.githubRepo
          ? {
              type: "github",
              repo: params.githubRepo,
            }
          : undefined,
      },
      context
    );

    if (!deployResult.success) {
      return deployResult;
    }

    const deployUrl = deployResult.output?.url;
    const message = `🚀 Deployment successful!\nProject: ${params.projectName}\nURL: ${deployUrl}`;

    // Create deployment documentation
    if (params.createDeploymentDoc) {
      await this.toolManager.executeTool(
        "googledocs.create",
        {
          title: `Deployment: ${params.projectName}`,
          text_content: `Deployment Details\n\nProject: ${params.projectName}\nURL: ${deployUrl}\nTimestamp: ${new Date().toISOString()}`,
        },
        context
      );
    }

    // Notify team
    if (params.notifyChannel) {
      await this.toolManager.executeTool(
        "slack.send_message",
        {
          channel: params.notifyChannel,
          text: message,
        },
        context
      );
    }

    return deployResult;
  }
}

/**
 * Factory function to create utilities instance
 */
export function createToolUtilities(toolManager: ToolIntegrationManager) {
  return new ToolUtilities(toolManager);
}
