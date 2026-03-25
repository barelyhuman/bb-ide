import { type ComponentProps, type ReactNode } from "react";
import { ThreadComposerPane } from "./ThreadComposerPane";

type ThreadComposerPaneProps = ComponentProps<typeof ThreadComposerPane>;

interface ThreadDetailPromptAreaProps {
  attachments: {
    attachmentError: ThreadComposerPaneProps["attachmentError"];
    attachments: ThreadComposerPaneProps["attachments"];
    isAttaching: ThreadComposerPaneProps["isAttaching"];
    onAttachFiles: ThreadComposerPaneProps["onAttachFiles"];
    onRemoveAttachment: ThreadComposerPaneProps["onRemoveAttachment"];
    projectId: ThreadComposerPaneProps["projectId"];
  };
  banner: {
    canExpandPromptChangeList: ThreadComposerPaneProps["canExpandPromptChangeList"];
    isChangeListExpanded: ThreadComposerPaneProps["isChangeListExpanded"];
    isDiffPanelActive: ThreadComposerPaneProps["isDiffPanelActive"];
    mergeBaseBranchOptions: ThreadComposerPaneProps["mergeBaseBranchOptions"];
    mergeBaseBranchOptionsLoading: ThreadComposerPaneProps["mergeBaseBranchOptionsLoading"];
    onPromptBannerFileClick: ThreadComposerPaneProps["onPromptBannerFileClick"];
    onPromptBannerMergeBaseBranchChange: ThreadComposerPaneProps["onPromptBannerMergeBaseBranchChange"];
    onPromptBannerMergeBaseBranchPickerOpenChange: ThreadComposerPaneProps["onPromptBannerMergeBaseBranchPickerOpenChange"];
    onPromptGitStatsBannerClick: ThreadComposerPaneProps["onPromptGitStatsBannerClick"];
    onToggleChangeListExpanded: ThreadComposerPaneProps["onToggleChangeListExpanded"];
    promptBannerMergeBaseBranch: ThreadComposerPaneProps["promptBannerMergeBaseBranch"];
    promptBannerSummary: ThreadComposerPaneProps["promptBannerSummary"];
    showBranchComparisonUi: ThreadComposerPaneProps["showBranchComparisonUi"];
    showPromptGitStatsBanner: ThreadComposerPaneProps["showPromptGitStatsBanner"];
    workspaceStatus: ThreadComposerPaneProps["workspaceStatus"];
  };
  composer: {
    canSendFollowUp: ThreadComposerPaneProps["canSendFollowUp"];
    composerRef: ThreadComposerPaneProps["composerRef"];
    isFollowUpSubmitting: ThreadComposerPaneProps["isFollowUpSubmitting"];
    message: ThreadComposerPaneProps["message"];
    onChangeMessage: ThreadComposerPaneProps["onChangeMessage"];
    onStop: ThreadComposerPaneProps["onStop"];
    onSubmit: ThreadComposerPaneProps["onSubmit"];
    processingQueuedMessageId: ThreadComposerPaneProps["processingQueuedMessageId"];
    promptPlaceholder: ThreadComposerPaneProps["promptPlaceholder"];
    provisioningStatusLabel: ThreadComposerPaneProps["provisioningStatusLabel"];
    threadId: ThreadComposerPaneProps["threadId"];
    threadStatus: ThreadComposerPaneProps["threadStatus"];
  };
  environment: {
    contextWindowUsage: ThreadComposerPaneProps["contextWindowUsage"];
    environmentIcon?: ThreadComposerPaneProps["environmentIcon"];
    environmentLabel?: ReactNode;
  };
  execution: {
    activeModel: ThreadComposerPaneProps["activeModel"];
    hasMultipleProviders: ThreadComposerPaneProps["hasMultipleProviders"];
    modelOptions: ThreadComposerPaneProps["modelOptions"];
    onReasoningLevelChange: ThreadComposerPaneProps["onReasoningLevelChange"];
    onSandboxModeChange: ThreadComposerPaneProps["onSandboxModeChange"];
    onSelectedModelChange: ThreadComposerPaneProps["onSelectedModelChange"];
    onServiceTierChange: ThreadComposerPaneProps["onServiceTierChange"];
    providerDisplayName: ThreadComposerPaneProps["providerDisplayName"];
    providerOptions: ThreadComposerPaneProps["providerOptions"];
    reasoningLevel: ThreadComposerPaneProps["reasoningLevel"];
    reasoningOptions: ThreadComposerPaneProps["reasoningOptions"];
    sandboxMode: ThreadComposerPaneProps["sandboxMode"];
    sandboxOptions: ThreadComposerPaneProps["sandboxOptions"];
    selectedModel: ThreadComposerPaneProps["selectedModel"];
    selectedProviderId: ThreadComposerPaneProps["selectedProviderId"];
    serviceTier: ThreadComposerPaneProps["serviceTier"];
    supportsServiceTier: ThreadComposerPaneProps["supportsServiceTier"];
  };
  mentions: {
    mentionError: ThreadComposerPaneProps["mentionError"];
    mentionLoading: ThreadComposerPaneProps["mentionLoading"];
    mentionSearchScope: ThreadComposerPaneProps["mentionSearchScope"];
    mentionSuggestions: ThreadComposerPaneProps["mentionSuggestions"];
    onMentionQueryChange: ThreadComposerPaneProps["onMentionQueryChange"];
  };
  queue: {
    isQueueMutationPending: ThreadComposerPaneProps["isQueueMutationPending"];
    onDeleteQueuedMessage: ThreadComposerPaneProps["onDeleteQueuedMessage"];
    onEditQueuedMessage: ThreadComposerPaneProps["onEditQueuedMessage"];
    onSendQueuedImmediately: ThreadComposerPaneProps["onSendQueuedImmediately"];
    queuedMessages: ThreadComposerPaneProps["queuedMessages"];
    showScrollToBottom: ThreadComposerPaneProps["showScrollToBottom"];
    onScrollToBottom: ThreadComposerPaneProps["onScrollToBottom"];
  };
}

export function ThreadDetailPromptArea({
  attachments,
  banner,
  composer,
  environment,
  execution,
  mentions,
  queue,
}: ThreadDetailPromptAreaProps) {
  return (
    <ThreadComposerPane
      composerRef={composer.composerRef}
      provisioningStatusLabel={composer.provisioningStatusLabel}
      showScrollToBottom={queue.showScrollToBottom}
      onScrollToBottom={queue.onScrollToBottom}
      showPromptGitStatsBanner={banner.showPromptGitStatsBanner}
      isDiffPanelActive={banner.isDiffPanelActive}
      canExpandPromptChangeList={banner.canExpandPromptChangeList}
      isChangeListExpanded={banner.isChangeListExpanded}
      onToggleChangeListExpanded={banner.onToggleChangeListExpanded}
      promptBannerSummary={banner.promptBannerSummary}
      showBranchComparisonUi={banner.showBranchComparisonUi}
      promptBannerMergeBaseBranch={banner.promptBannerMergeBaseBranch}
      mergeBaseBranchOptions={banner.mergeBaseBranchOptions}
      mergeBaseBranchOptionsLoading={banner.mergeBaseBranchOptionsLoading}
      onPromptBannerMergeBaseBranchChange={banner.onPromptBannerMergeBaseBranchChange}
      onPromptBannerMergeBaseBranchPickerOpenChange={
        banner.onPromptBannerMergeBaseBranchPickerOpenChange
      }
      workspaceStatus={banner.workspaceStatus}
      threadId={composer.threadId}
      onPromptGitStatsBannerClick={banner.onPromptGitStatsBannerClick}
      onPromptBannerFileClick={banner.onPromptBannerFileClick}
      queuedMessages={queue.queuedMessages}
      canSendFollowUp={composer.canSendFollowUp}
      isFollowUpSubmitting={composer.isFollowUpSubmitting}
      isQueueMutationPending={queue.isQueueMutationPending}
      processingQueuedMessageId={composer.processingQueuedMessageId}
      onSendQueuedImmediately={queue.onSendQueuedImmediately}
      onEditQueuedMessage={queue.onEditQueuedMessage}
      onDeleteQueuedMessage={queue.onDeleteQueuedMessage}
      message={composer.message}
      onChangeMessage={composer.onChangeMessage}
      onSubmit={composer.onSubmit}
      threadStatus={composer.threadStatus}
      onStop={composer.onStop}
      promptPlaceholder={composer.promptPlaceholder}
      mentionSuggestions={mentions.mentionSuggestions}
      mentionSearchScope={mentions.mentionSearchScope}
      mentionLoading={mentions.mentionLoading}
      mentionError={mentions.mentionError}
      onMentionQueryChange={mentions.onMentionQueryChange}
      attachments={attachments.attachments}
      projectId={attachments.projectId}
      onAttachFiles={attachments.onAttachFiles}
      onRemoveAttachment={attachments.onRemoveAttachment}
      isAttaching={attachments.isAttaching}
      attachmentError={attachments.attachmentError}
      hasMultipleProviders={execution.hasMultipleProviders}
      providerOptions={execution.providerOptions}
      selectedProviderId={execution.selectedProviderId}
      providerDisplayName={execution.providerDisplayName}
      activeModel={execution.activeModel}
      selectedModel={execution.selectedModel}
      modelOptions={execution.modelOptions}
      onSelectedModelChange={execution.onSelectedModelChange}
      serviceTier={execution.serviceTier}
      onServiceTierChange={execution.onServiceTierChange}
      supportsServiceTier={execution.supportsServiceTier}
      reasoningLevel={execution.reasoningLevel}
      reasoningOptions={execution.reasoningOptions}
      onReasoningLevelChange={execution.onReasoningLevelChange}
      sandboxMode={execution.sandboxMode}
      sandboxOptions={execution.sandboxOptions}
      onSandboxModeChange={execution.onSandboxModeChange}
      environmentLabel={environment.environmentLabel}
      environmentIcon={environment.environmentIcon}
      contextWindowUsage={environment.contextWindowUsage}
    />
  );
}
