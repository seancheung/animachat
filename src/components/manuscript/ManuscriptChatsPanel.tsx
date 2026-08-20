"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpenText,
  History,
  MessageCircleMore,
  MessageSquarePlus,
  Plus,
  SendHorizontal,
  Square,
  Trash2,
  UsersRound,
} from "lucide-react";
import { MentionInputBox } from "@/components/chat/MentionInputBox";
import { MessageText } from "@/components/MessageText";
import { confirmDialog } from "@/components/confirm";
import Button from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox";
import Dialog from "@/components/ui/dialog";
import Popover from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { truncateManuscriptConversationAtUserMessage } from "@/lib/ai/manuscriptConversation";
import {
  latestManuscriptConversationSession,
  manuscriptConversationKey,
} from "@/lib/manuscript";
import {
  mentionsToPlain,
  tagMentions,
} from "@/lib/mentions";
import { streamSse, timestamp, uid } from "@/lib/ui";
import type {
  Manuscript,
  ManuscriptChapterContextMode,
  ManuscriptConversation,
  ManuscriptConversationMessage,
  ManuscriptConversationSession,
} from "@/lib/types";

function chapterContextNote(count: number, mode: ManuscriptChapterContextMode): string {
  if (!count) return " No chapters are attached.";
  return ` ${count} chapter${count === 1 ? " is" : "s are"} attached as ${mode === "full" ? "full content" : "summaries"}.`;
}

function memberNames(manuscript: Manuscript, conversation: ManuscriptConversation) {
  return conversation.characterIds
    .map((id) => manuscript.characters.find((character) => character.id === id)?.name)
    .filter((name): name is string => !!name);
}

export function ManuscriptChatsPanel({
  manuscript,
  onSaveConversation,
}: {
  manuscript: Manuscript;
  onSaveConversation: (conversation: ManuscriptConversation, create?: boolean) => void;
}) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [pickedChapterIds, setPickedChapterIds] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<{ characterId: string; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageListPinnedRef = useRef(true);
  const messageListViewRef = useRef("");

  useEffect(() => () => abortRef.current?.abort(), []);

  const conversations = useMemo(
    () => [...manuscript.conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [manuscript.conversations]
  );
  const activeConversation = manuscript.conversations.find(
    (conversation) => conversation.id === activeConversationId
  ) ?? null;
  const activeSession = activeConversation?.sessions.find(
    (session) => session.id === activeSessionId
  ) ?? (activeConversation ? latestManuscriptConversationSession(activeConversation) : null);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list || !activeConversation) return;

    const view = `${activeConversation.id}:${activeSession?.id ?? "new"}`;
    const changedView = messageListViewRef.current !== view;
    messageListViewRef.current = view;
    if (changedView) messageListPinnedRef.current = true;
    if (!messageListPinnedRef.current) return;

    list.scrollTop = list.scrollHeight;
    if (changedView) {
      requestAnimationFrame(() => {
        if (messageListPinnedRef.current) list.scrollTop = list.scrollHeight;
      });
    }
  }, [
    activeConversation,
    activeSession?.id,
    activeSession?.messages.length,
    streaming?.characterId,
    streaming?.text,
  ]);

  function onMessageListScroll() {
    const list = messageListRef.current;
    if (!list) return;
    messageListPinnedRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  }

  function openConversation(conversation: ManuscriptConversation) {
    setActiveConversationId(conversation.id);
    setActiveSessionId(latestManuscriptConversationSession(conversation)?.id ?? null);
    setInput("");
  }

  function openPicker() {
    setSelectedCharacterIds([]);
    setPickerOpen(true);
  }

  function createConversation() {
    if (!selectedCharacterIds.length) return;
    const key = manuscriptConversationKey(selectedCharacterIds);
    const existing = manuscript.conversations.find(
      (conversation) => manuscriptConversationKey(conversation.characterIds) === key
    );
    setPickerOpen(false);
    setSelectedCharacterIds([]);
    if (existing) {
      openConversation(existing);
      return;
    }
    const t = timestamp();
    const conversation: ManuscriptConversation = {
      id: uid(),
      characterIds: [...selectedCharacterIds].sort(),
      chapterIds: [],
      sessions: [],
      createdAt: t,
      updatedAt: t,
    };
    onSaveConversation(conversation, true);
    setActiveConversationId(conversation.id);
    setActiveSessionId(null);
  }

  function openChapterPicker() {
    if (!activeConversation) return;
    setPickedChapterIds(activeConversation.chapterIds);
    setChapterPickerOpen(true);
  }

  function savePickedChapters() {
    if (!activeConversation) return;
    onSaveConversation({
      ...activeConversation,
      chapterIds: pickedChapterIds,
      updatedAt: timestamp(),
    });
    setChapterPickerOpen(false);
  }

  function saveSession(
    conversation: ManuscriptConversation,
    session: ManuscriptConversationSession
  ) {
    const sessions = conversation.sessions.some((item) => item.id === session.id)
      ? conversation.sessions.map((item) => item.id === session.id ? session : item)
      : [...conversation.sessions, session];
    onSaveConversation({ ...conversation, sessions, updatedAt: timestamp() });
  }

  function newSession() {
    if (!activeConversation || !activeSession?.messages.length) return;
    const t = timestamp();
    const session: ManuscriptConversationSession = {
      id: uid(),
      title: "New session",
      messages: [],
      createdAt: t,
      updatedAt: t,
    };
    setActiveSessionId(session.id);
    saveSession(activeConversation, session);
  }

  async function deleteChatSession(session: ManuscriptConversationSession) {
    if (!activeConversation || busy || !(await confirmDialog({
      title: "Delete chat session",
      message: `Delete “${session.title}”? Its ${session.messages.length.toLocaleString()} message${session.messages.length === 1 ? "" : "s"} will be removed.`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    const sessions = activeConversation.sessions.filter((item) => item.id !== session.id);
    if (activeSession?.id === session.id) {
      setActiveSessionId(latestManuscriptConversationSession({ ...activeConversation, sessions })?.id ?? null);
    }
    onSaveConversation({ ...activeConversation, sessions, updatedAt: timestamp() });
  }

  async function deleteUserMessage(index: number) {
    if (!activeConversation || !activeSession || busy) return;
    const messages = truncateManuscriptConversationAtUserMessage(activeSession.messages, index);
    if (messages === activeSession.messages) return;
    const following = activeSession.messages.length - index - 1;
    if (!(await confirmDialog({
      title: "Delete author message",
      message: following
        ? `Delete this message and the ${following.toLocaleString()} message${following === 1 ? "" : "s"} after it?`
        : "Delete this message?",
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    const firstUser = messages.find((message) => message.role === "user")?.content.trim();
    saveSession(activeConversation, {
      ...activeSession,
      title: firstUser ? mentionsToPlain(firstUser).slice(0, 42) : "New session",
      messages,
      updatedAt: timestamp(),
    });
  }

  function persistMessages(
    conversation: ManuscriptConversation,
    session: ManuscriptConversationSession,
    messages: ManuscriptConversationMessage[]
  ) {
    const firstUser = messages.find((message) => message.role === "user")?.content.trim();
    saveSession(conversation, {
      ...session,
      title: session.title === "New session" && firstUser
        ? mentionsToPlain(firstUser).slice(0, 42)
        : session.title,
      messages,
      updatedAt: timestamp(),
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !activeConversation) return;
    let session = activeSession;
    if (!session) {
      const t = timestamp();
      session = {
        id: uid(),
        title: "New session",
        messages: [],
        createdAt: t,
        updatedAt: t,
      };
      setActiveSessionId(session.id);
    }

    const memberNames = activeConversation.characterIds
      .map((id) => manuscript.characters.find((character) => character.id === id)?.name)
      .filter((name): name is string => !!name);
    const userMessage: ManuscriptConversationMessage = {
      role: "user",
      characterId: null,
      content: tagMentions(text, memberNames),
      createdAt: timestamp(),
    };
    const history = [...session.messages, userMessage];
    const pendingSession = { ...session, messages: history, updatedAt: timestamp() };
    messageListPinnedRef.current = true;
    persistMessages(activeConversation, pendingSession, history);
    setInput("");
    setBusy(true);
    setStreaming(null);

    let committedMessages = history;
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamSse("/api/manuscripts/generate", {
        action: "conversation-chat",
        manuscript,
        characterIds: activeConversation.characterIds,
        chapterIds: activeConversation.chapterIds,
        messages: history,
      }, (event) => {
        if (event.type === "start" && typeof event.speaker?.characterId === "string") {
          setStreaming({ characterId: event.speaker.characterId, text: "" });
        } else if (event.type === "context-limit") {
          const details = [];
          if (event.chapter) {
            details.push(
              `Using about ${Number(event.chapter.includedTokens).toLocaleString()} of ${Number(event.chapter.originalTokens).toLocaleString()} attached-chapter tokens.`
            );
          }
          if (event.omittedHistoryMessages) {
            details.push(`${Number(event.omittedHistoryMessages).toLocaleString()} older chat messages omitted.`);
          }
          toast.warning(details.join(" "));
        } else if (event.type === "text") {
          setStreaming((current) => current
            ? { ...current, text: current.text + event.text }
            : null);
        } else if (event.type === "done") {
          const reply = event.message as ManuscriptConversationMessage | null;
          if (reply?.role === "character" && reply.characterId) {
            committedMessages = [...committedMessages, reply];
            persistMessages(activeConversation, pendingSession, committedMessages);
          }
          setStreaming(null);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }, abort.signal);
    } catch (error) {
      if (!abort.signal.aborted) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStreaming(null);
    }
  }

  const names = activeConversation ? memberNames(manuscript, activeConversation) : [];
  const conversationTitle = names.join(", ");

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-base-400 pl-4 pb-4">
      {!activeConversation ? (
        <>
          <div className="mb-2 flex items-center gap-2">
            <MessageCircleMore size={15} className="text-primary-500" />
            <span className="text-xs uppercase tracking-wider text-content-300">Chats</span>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" title="New conversation" onClick={openPicker}>
              <Plus /> New
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {!conversations.length && (
              <div className="py-8 text-center text-sm text-content-400">
                No conversations yet. Pick one or more embedded characters to begin.
              </div>
            )}
            <div className="space-y-1">
              {conversations.map((conversation) => {
                const itemNames = memberNames(manuscript, conversation);
                const recent = latestManuscriptConversationSession(conversation);
                const preview = recent?.messages.at(-1)?.content
                  ? mentionsToPlain(recent.messages.at(-1)!.content)
                  : "No messages yet";
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2.5 text-left hover:bg-base-300/60"
                    onClick={() => openConversation(conversation)}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-500/10 text-primary-500">
                      {itemNames.length === 1
                        ? <span className="text-sm font-semibold">{itemNames[0].slice(0, 1).toUpperCase()}</span>
                        : <UsersRound size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{itemNames.join(", ")}</span>
                      <span className="mt-0.5 block truncate text-xs text-content-400">{preview}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              shape="square"
              title="Back to conversations"
              disabled={busy}
              onClick={() => setActiveConversationId(null)}
            >
              <ArrowLeft />
            </Button>
            <div className="min-w-0 ml-1">
              <div className="truncate text-sm font-medium">{conversationTitle}</div>
              <div className="truncate text-[11px] text-content-400">
                {names.length} character{names.length === 1 ? "" : "s"} · fixed members
              </div>
            </div>
            <span className="flex-1" />
            <Popover
              side="bottom"
              align="end"
              className="w-64 p-1.5"
              content={({ close }) => (
                <>
                  <div className="flex items-center px-2 py-1.5">
                    <span className="text-xs uppercase tracking-wider text-content-400">Sessions</span>
                    <span className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Start a fresh session without carried history"
                      disabled={busy || !activeSession?.messages.length}
                      onClick={() => { close(); newSession(); }}
                    >
                      <MessageSquarePlus /> New
                    </Button>
                  </div>
                  {!activeConversation.sessions.length && (
                    <div className="px-2 py-3 text-xs text-content-400">No sessions yet.</div>
                  )}
                  {[...activeConversation.sessions]
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map((session) => (
                      <div
                        key={session.id}
                        className={`flex items-center gap-1 rounded-md pr-1 ${session.id === activeSession?.id ? "bg-base-300 font-medium" : "hover:bg-base-300/60"}`}
                      >
                        <button
                          type="button"
                          disabled={busy}
                          className="min-w-0 flex-1 cursor-pointer truncate rounded-md px-2.5 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => { setActiveSessionId(session.id); close(); }}
                        >
                          {session.title}
                        </button>
                        <Button
                          variant="danger"
                          size="sm"
                          shape="square"
                          title={`Delete session “${session.title}”`}
                          disabled={busy}
                          onClick={() => { close(); void deleteChatSession(session); }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                </>
              )}
            >
              <Button
                variant="ghost"
                size="sm"
                shape="square"
                title={`Sessions${activeSession ? ` — ${activeSession.title}` : ""}`}
              >
                <History />
              </Button>
            </Popover>
          </div>

          <div
            ref={messageListRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
            onScroll={onMessageListScroll}
          >
            {!activeSession?.messages.length && !streaming && (
              <div className="py-8 text-sm leading-relaxed text-content-400">
                Talk with {conversationTitle} while you work. This conversation’s members are fixed; start a new conversation for a different group.
                {chapterContextNote(activeConversation.chapterIds.length, manuscript.chapterContextMode)}
              </div>
            )}
            {activeSession?.messages.map((message, index) => (
              message.role === "user" ? (
                <div key={`${message.createdAt}-${index}`} className="group ml-8 text-sm">
                  <div className="mb-0.5 flex items-center justify-end gap-1 text-[11px] text-content-400">
                    <span>Author</span>
                    <Button
                      variant="danger"
                      size="sm"
                      shape="square"
                      className="size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      title="Delete this message and all messages after it"
                      disabled={busy}
                      onClick={() => void deleteUserMessage(index)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="rounded-lg bg-primary-500/15 px-3 py-2">
                    <MessageText text={message.content} />
                  </div>
                </div>
              ) : (() => {
                const character = manuscript.characters.find((item) => item.id === message.characterId);
                return (
                  <div key={`${message.createdAt}-${index}`} className="flex gap-2 text-sm">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-base-300 text-xs font-semibold">
                      {character?.name.slice(0, 1).toUpperCase() ?? "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 text-[11px] text-content-400">{character?.name ?? "Unknown character"}</div>
                      <MessageText text={message.content} />
                    </div>
                  </div>
                );
              })()
            ))}
            {streaming && (() => {
              const character = manuscript.characters.find((item) => item.id === streaming.characterId);
              return (
                <div className="flex gap-2 text-sm">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-base-300 text-xs font-semibold">
                    {character?.name.slice(0, 1).toUpperCase() ?? "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 text-[11px] text-content-400">{character?.name ?? "Unknown character"}</div>
                    <MessageText text={streaming.text} streaming />
                  </div>
                </div>
              );
            })()}
          </div>

          <MentionInputBox
            mentionNames={names.length > 1 ? names : []}
            className="mt-2"
            textareaClassName="h-16"
            placeholder={names.length > 1
              ? "Message… (@ to address someone)"
              : `Message ${conversationTitle}…`}
            value={input}
            onChange={setInput}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              title={`Attach chapters${activeConversation.chapterIds.length ? ` (${activeConversation.chapterIds.length})` : ""}`}
              disabled={busy}
              onClick={openChapterPicker}
            >
              <BookOpenText />
              {activeConversation.chapterIds.length || null}
            </Button>
            <span className="flex-1" />
            {busy ? (
              <Button variant="danger" size="sm" shape="square" title="Stop" onClick={() => abortRef.current?.abort()}>
                <Square />
              </Button>
            ) : (
              <Button size="sm" shape="square" title="Send" disabled={!input.trim()} onClick={() => void send()}>
                <SendHorizontal />
              </Button>
            )}
          </MentionInputBox>
        </>
      )}

      <Dialog
        open={chapterPickerOpen && !!activeConversation}
        onOpenChange={setChapterPickerOpen}
        title="Attach chapters"
        description={`Selected chapters are injected as ${manuscript.chapterContextMode === "full" ? "full content" : "summaries"}. Empty ${manuscript.chapterContextMode === "full" ? "chapters" : "summaries"} are skipped.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setChapterPickerOpen(false)}>Cancel</Button>
            <Button onClick={savePickedChapters}>Save attachments</Button>
          </>
        }
      >
        <div className="space-y-1">
          {manuscript.chapters.map((chapter) => (
            <div key={chapter.id} className="rounded-md px-2.5 py-2 hover:bg-base-300/60">
              <Checkbox
                className="w-full"
                value={pickedChapterIds.includes(chapter.id)}
                onChange={(checked) => setPickedChapterIds((current) => checked
                  ? [...current, chapter.id]
                  : current.filter((id) => id !== chapter.id))}
                label={<span className="font-medium">{chapter.title}</span>}
              />
            </div>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="New conversation"
        description="Choose one or more embedded characters. Conversation members cannot be changed later."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPickerOpen(false)}>Cancel</Button>
            <Button disabled={!selectedCharacterIds.length} onClick={createConversation}>
              Create conversation
            </Button>
          </>
        }
      >
        <div className="space-y-1">
          {!manuscript.characters.length && (
            <div className="py-6 text-center text-content-400">Add an embedded character first.</div>
          )}
          {manuscript.characters.map((character) => (
            <div key={character.id} className="rounded-md px-2.5 py-2 hover:bg-base-300/60">
              <Checkbox
                className="w-full"
                value={selectedCharacterIds.includes(character.id)}
                onChange={(checked) => setSelectedCharacterIds((current) => checked
                  ? [...current, character.id]
                  : current.filter((id) => id !== character.id))}
                label={<span className="font-medium">{character.name}</span>}
              />
            </div>
          ))}
        </div>
      </Dialog>
    </aside>
  );
}
