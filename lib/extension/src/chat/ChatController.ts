import { util, webviewApi } from "@rubberduck/common";
import * as vscode from "vscode";
import { DiffEditorManager } from "../diff/DiffEditorManager";
import { OpenAIClient } from "../openai/OpenAIClient";
import { ChatModel } from "./ChatModel";
import { ChatPanel } from "./ChatPanel";
import { ConversationModel } from "./ConversationModel";
import { ConversationModelFactory } from "./ConversationModelFactory";
import { getInput } from "./getInput";
import { getOptionalSelectedText } from "./getOptionalSelectedText";

export class ChatController {
  private readonly chatPanel: ChatPanel;
  private readonly chatModel: ChatModel;
  private readonly openAIClient: OpenAIClient;
  private readonly conversationTypes: Record<string, ConversationModelFactory>;
  private readonly diffEditorManager: DiffEditorManager;
  private readonly basicChatTemplateId: string;
  private readonly generateConversationId: () => string;

  constructor({
    chatPanel,
    chatModel,
    openAIClient,
    conversationTypes,
    diffEditorManager,
    basicChatTemplateId,
  }: {
    chatPanel: ChatPanel;
    chatModel: ChatModel;
    openAIClient: OpenAIClient;
    conversationTypes: Record<string, ConversationModelFactory>;
    diffEditorManager: DiffEditorManager;
    basicChatTemplateId: string;
  }) {
    this.chatPanel = chatPanel;
    this.chatModel = chatModel;
    this.openAIClient = openAIClient;
    this.conversationTypes = conversationTypes;
    this.diffEditorManager = diffEditorManager;
    this.basicChatTemplateId = basicChatTemplateId;

    this.generateConversationId = util.createNextId({
      prefix: "conversation-",
    });
  }

  private async updateChatPanel() {
    await this.chatPanel.update(this.chatModel);
  }

  private async addAndShowConversation<T extends ConversationModel>(
    conversation: T
  ): Promise<T> {
    this.chatModel.addAndSelectConversation(conversation);

    await this.showChatPanel();
    await this.updateChatPanel();

    return conversation;
  }

  async showChatPanel() {
    await vscode.commands.executeCommand("rubberduck.chat.focus");
  }

  async receivePanelMessage(rawMessage: unknown) {
    const message = webviewApi.outgoingMessageSchema.parse(rawMessage);
    const type = message.type;

    switch (type) {
      case "clickCollapsedConversation": {
        this.chatModel.selectedConversationId = message.data.id;
        await this.updateChatPanel();
        break;
      }
      case "sendMessage": {
        await this.chatModel
          .getConversationById(message.data.id)
          ?.answer(message.data.message);
        break;
      }
      case "startChat": {
        await this.createConversation(this.basicChatTemplateId);
        break;
      }
      case "deleteConversation": {
        this.chatModel.deleteConversation(message.data.id);
        await this.updateChatPanel();
        break;
      }
      case "retry": {
        await this.chatModel.getConversationById(message.data.id)?.retry();
        break;
      }
      case "applyDiff": {
        break;
      }
      default: {
        const exhaustiveCheck: never = type;
        throw new Error(`unsupported type: ${exhaustiveCheck}`);
      }
    }
  }

  async createConversation(conversationTypeId: string) {
    const factory = this.conversationTypes[conversationTypeId];

    if (factory == undefined) {
      await vscode.window.showErrorMessage(
        `No conversation type found for ${conversationTypeId}`
      );

      return;
    }

    const availableInputs: Record<string, getInput<unknown>> = {
      optionalSelectedText: getOptionalSelectedText,
    };

    const initData = new Map<string, unknown>();

    for (const inputKey of factory.inputs) {
      const input = availableInputs[inputKey];

      if (input == undefined) {
        await vscode.window.showErrorMessage(
          `No input found for input '${inputKey}'`
        );

        return;
      }

      const initResult = await input();

      if (initResult.result === "unavailable") {
        if (initResult.type === "info") {
          await vscode.window.showInformationMessage(initResult.message);
        } else if (initResult.type === "error") {
          await vscode.window.showErrorMessage(initResult.message);
        }

        return;
      }

      initData.set(inputKey, initResult.data);
    }

    const result = await factory.createConversationModel({
      generateChatId: this.generateConversationId,
      openAIClient: this.openAIClient,
      updateChatPanel: this.updateChatPanel.bind(this),
      diffEditorManager: this.diffEditorManager,
      initData,
    });

    if (result.result === "unavailable") {
      if (result.type === "info") {
        await vscode.window.showInformationMessage(result.message);
      } else if (result.type === "error") {
        await vscode.window.showErrorMessage(result.message);
      }

      return;
    }

    await this.addAndShowConversation(result.conversation);

    if (result.shouldImmediatelyAnswer) {
      await result.conversation.answer();
    }
  }
}
