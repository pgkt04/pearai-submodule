import { OpenAIClient } from "../openai/OpenAIClient";
import { CodeSection } from "../prompt/CodeSection";
import { ConversationModel } from "./ConversationModel";
import { ConversationModelFactoryResult } from "./ConversationModelFactory";
import { generateChatCompletion } from "./generateChatCompletion";
import { getOptionalSelectedText } from "./getOptionalSelectedText";

export class ChatConversationModel extends ConversationModel {
  static id = "chat";

  static async createConversationModel({
    generateChatId,
    openAIClient,
    updateChatPanel,
  }: {
    generateChatId: () => string;
    openAIClient: OpenAIClient;
    updateChatPanel: () => Promise<void>;
  }): Promise<ConversationModelFactoryResult> {
    const result = await getOptionalSelectedText();

    if (result.result === "unavailable") {
      return result;
    }

    const { selectedText } = result.data;

    return {
      result: "success",
      conversation: new ChatConversationModel(
        {
          id: generateChatId(),
          selectedText,
        },
        {
          openAIClient,
          updateChatPanel,
        }
      ),
      shouldImmediatelyAnswer: false,
    };
  }

  readonly selectedText: string | undefined;

  constructor(
    {
      id,
      selectedText,
    }: {
      id: string;
      selectedText?: string | undefined;
    },
    {
      openAIClient,
      updateChatPanel,
    }: {
      openAIClient: OpenAIClient;
      updateChatPanel: () => Promise<void>;
    }
  ) {
    super({
      id,
      initialState: { type: "userCanReply" },
      openAIClient,
      updateChatPanel,
    });

    this.selectedText = selectedText;
  }

  getTitle(): string {
    return this.messages[0]?.content ?? "New Chat";
  }

  isTitleMessage(): boolean {
    return this.messages.length > 0;
  }

  getCodicon(): string {
    return "comment-discussion";
  }

  private async executeChat() {
    const completion = await generateChatCompletion({
      introSections:
        this.selectedText != null
          ? [
              new CodeSection({
                title: "Selected Code",
                code: this.selectedText,
              }),
            ]
          : [],
      messages: this.messages,
      openAIClient: this.openAIClient,
    });

    if (completion.type === "error") {
      await this.setErrorStatus({ errorMessage: completion.errorMessage });
      return;
    }

    await this.addBotMessage({
      content: completion.content.trim(),
    });
  }

  async retry() {
    this.state = { type: "waitingForBotAnswer" };
    await this.updateChatPanel();

    await this.executeChat();
  }

  async answer(userMessage?: string) {
    if (userMessage != undefined) {
      await this.addUserMessage({ content: userMessage });
    }

    await this.executeChat();
  }
}
