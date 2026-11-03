import { Action, ActionPanel, getPreferenceValues, Icon, Keyboard, List, showToast, Toast } from '@raycast/api'
import { homedir } from 'node:os'
import { useEffect, useState } from 'react'
import { ApprovalSection, SetUpAction } from './common'
import { NO_MODEL_TITLE } from './lib/offer-set-up'
import { exchanges, lastQuestion, newChat, titleFrom, withoutThinking, type Chat, type Exchange } from './lib/chats'
import { saveChat } from './lib/history'
import { whereLabel } from './lib/labels'
import { naviHome } from './lib/model'
import { answerOf, turnMarkdown } from './lib/turn'
import { takeNote } from 'neonavi/undo'
import { redoLast, undoableFor, undoLast } from './lib/undo-last'
import { useNavi } from './lib/use-navi'

export function Conversation({ initialChat }: { initialChat?: Chat }) {
  const { showReasoning } = getPreferenceValues<Preferences>()
  const [chat, setChat] = useState<Chat>(initialChat ?? newChat())
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const { navi, turn, streaming, approval, run, stop, recheck } = useNavi()
  // RAY-13: the question whose file changes can be put back, if the latest kept turn is in this chat.
  const [undoable, setUndoable] = useState<string | null>(null)
  // RAY-19: the model that gave the latest answer, while this view knows it.
  const [answeredBy, setAnsweredBy] = useState<string>()

  async function checkUndo(question?: string) {
    const turn = question && (await undoableFor(homedir(), await naviHome(), question))
    setUndoable(turn ? question : null)
  }
  useEffect(() => {
    checkUndo(exchanges(chat.history)[0]?.question)
  }, [chat.id])

  async function undoChanges() {
    const dir = await naviHome()
    const lines = await undoLast(homedir(), dir)
    setUndoable(null)
    if (!lines) {
      await showToast({ style: Toast.Style.Failure, title: 'Nothing to undo' })
      return
    }
    await showToast({
      style: Toast.Style.Success,
      title: 'Undid file changes',
      message: lines.join('\n'),
      // RAY-14: a mistaken undo is one action away from being taken back.
      primaryAction: {
        title: 'Redo',
        onAction: async (toast) => {
          const redone = await redoLast(homedir(), dir)
          toast.style = redone ? Toast.Style.Success : Toast.Style.Failure
          toast.title = redone ? 'Redid file changes' : 'Nothing to redo'
          toast.message = redone?.join('\n')
          await checkUndo(exchanges(chat.history)[0]?.question)
        },
      },
    })
  }

  async function send() {
    const question = input.trim()
    if (!question || streaming || !navi) return
    setInput('')
    // The stored history goes back into a harness session, so the chat continues (RAY-4, HAR-3).
    await ask(question, chat.history)
  }

  /** RAY-19: the latest question again, from the chat as it was before it. */
  async function askAgain() {
    const last = lastQuestion(chat.history)
    if (!last || streaming || !navi) return
    if (undoable) {
      await showToast({ style: Toast.Style.Failure, title: 'Undo File Changes first', message: 'So the second try starts from the files the first one found.' })
      return
    }
    // An undo since that turn was of the turn being replaced, which the model will never see (CLI-34).
    await takeNote(homedir(), await naviHome()).catch(() => undefined)
    // Shown without the answer it replaces while the new one comes.
    setChat({ ...chat, history: last.before })
    await ask(last.prompt, last.before, last.attachments, answeredBy, chat)
  }

  async function ask(question: string, history: Chat['history'], attachments?: Parameters<typeof run>[2], again?: string, restore?: Chat) {
    setPending(question)
    const answered = await run(question, history, attachments, again)
    setPending(null)
    const said = answered && (answerOf(answered.turn) || answered.turn.items.length > 0)
    if (!answered || (!said && answered.turn.errors.length)) {
      // Nothing came: the chat is left as it was.
      if (restore) setChat(restore)
      else setInput(question)
      return
    }
    setAnsweredBy(answered.model)
    // Reasoning is not kept: it would crowd the context on every later turn.
    const updated: Chat = {
      ...chat,
      title: history.length ? chat.title : titleFrom(answered.history),
      history: withoutThinking(answered.history),
      updatedAt: Date.now(),
    }
    setChat(updated)
    await saveChat(updated)
    await checkUndo(question)
  }

  const shown: Exchange[] = exchanges(chat.history)
  if (pending) shown.unshift({ id: 'pending', question: pending, attached: [], turn })

  const actions = (exchange?: Exchange) => {
    const answer = exchange && answerOf(exchange.turn)
    return (
      <ActionPanel>
        {navi === null && <SetUpAction onDone={recheck} />}
        {approval && <ApprovalSection approval={approval} />}
        {input.trim() && !streaming && navi && <Action title="Send" icon={Icon.ArrowRight} onAction={send} />}
        {streaming && (
          <Action title="Stop" icon={Icon.Stop} shortcut={{ modifiers: ['cmd', 'shift'], key: '.' }} onAction={stop} />
        )}
        {answer && <Action.CopyToClipboard title="Copy Answer" content={answer} />}
        {exchange && exchange === shown[0] && !pending && !streaming && navi && (
          <Action
            title="Ask Again"
            icon={Icon.RotateClockwise}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
            onAction={askAgain}
          />
        )}
        {exchange && !streaming && exchange.question === undoable && (
          <Action
            title="Undo File Changes"
            icon={Icon.Undo}
            shortcut={{ modifiers: ['cmd'], key: 'z' }}
            onAction={undoChanges}
          />
        )}
        {exchange && (
          <Action.CopyToClipboard
            title="Copy Question"
            content={exchange.question}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
        )}
        {!streaming && chat.history.length > 0 && (
          <Action
            title="New Chat"
            icon={Icon.Plus}
            shortcut={Keyboard.Shortcut.Common.New}
            onAction={() => setChat(newChat())}
          />
        )}
      </ActionPanel>
    )
  }

  return (
    <List
      navigationTitle={chat.history.length ? chat.title : 'New Chat'}
      searchBarPlaceholder={chat.history.length ? 'Ask a follow-up…' : 'Ask navi…'}
      searchText={input}
      onSearchTextChange={setInput}
      filtering={false}
      isLoading={(streaming && !approval) || navi === undefined}
      isShowingDetail={shown.length > 0}
      selectedItemId={shown[0]?.id}
    >
      {/* Raycast hides List-level actions whenever an empty view is present, so Send lives here. */}
      <List.EmptyView
        icon={navi === null ? Icon.Warning : Icon.SpeechBubble}
        title={navi === null ? NO_MODEL_TITLE : 'Type a message and press Enter'}
        description={navi === null ? 'Press Return to open Set Up Navi.' : navi && whereLabel(navi)}
        actions={actions()}
      />
      {shown.map((exchange) => {
        const live = exchange.id === 'pending'
        return (
          <List.Item
            key={exchange.id}
            id={exchange.id}
            title={exchange.question}
            accessories={
              exchange.attached.length
                ? [
                    {
                      icon: Icon.Paperclip,
                      text: String(exchange.attached.length),
                      tooltip: exchange.attached.join(', '),
                    },
                  ]
                : undefined
            }
            detail={
              <List.Item.Detail
                markdown={turnMarkdown(exchange.turn, {
                  streaming: live && streaming,
                  showReasoning,
                  approval: live ? approval : null,
                })}
              />
            }
            actions={actions(exchange)}
          />
        )
      })}
    </List>
  )
}
