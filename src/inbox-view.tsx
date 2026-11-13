import { Component, createRef, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { InboxController, InboxSnapshot } from './inbox.js';
import { Copy } from './results-card.js';

interface ListProps { view: InboxSnapshot; controller: InboxController; close(): void }

interface ListState { unused?: never }

interface FocusSnapshot { key: string; visible: boolean }

class InboxList extends Component<ListProps, ListState, FocusSnapshot | null> {
  list = createRef<HTMLUListElement>();
  getSnapshotBeforeUpdate(): FocusSnapshot | null {
    const focused = document.activeElement;

    return focused instanceof HTMLElement && this.list.current?.contains(focused)
      ? { key: JSON.stringify({ ...focused.dataset }), visible: focused.matches(':focus-visible') } : null;
  }
  componentDidUpdate(_props: Readonly<ListProps>, _state: Readonly<ListState>, snapshot: FocusSnapshot | null) {
    const list = this.list.current;

    if (!snapshot || !list || list.contains(document.activeElement)) return;
    const same = [...list.querySelectorAll('button')].find((button) => JSON.stringify({ ...button.dataset }) === snapshot.key);
    const options = { preventScroll: true, focusVisible: snapshot.visible };
    (same ?? document.getElementById('inbox-trigger'))?.focus(options);
  }
  render() {
    const { view, controller, close } = this.props;

    return <ul ref={this.list} id="inbox-list" className="inbox-list">{view.rows.map((row) => <li key={row.id} className="inbox-entry" data-kind={row.kind} data-unread={!row.entry.read ? 'true' : undefined}>
      <p><Copy parts={row.copy} /></p><span className="inbox-meta">{row.meta}</span>
      {row.action && <button type="button" className="btn btn-secondary btn-sm" data-inbox-action={row.kind} aria-disabled={row.waiting ? 'true' : undefined} onClick={() => {
        if (row.waiting) return;
        close();
        controller.act(row.entry);
      }}>{row.action}</button>}
    </li>)}</ul>;
  }
}

export function Inbox({ controller }: { controller: InboxController }) {
  const view = useSyncExternalStore(controller.subscribeView, controller.getSnapshot, controller.getSnapshot);
  const details = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = details.current;

    if (!element) return;

    const detach = controller.attachFocus({
      toastFocused: () => Boolean(document.getElementById('challenge-toast')?.contains(document.activeElement)),
      focusTrigger: () => trigger.current?.focus(),
    });

    const observer = new MutationObserver(() => {
      const account = document.getElementById('account');

      if (element.open && account instanceof HTMLDetailsElement) account.open = false;
    });

    observer.observe(element, { attributeFilter: ['open'] });
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !element.contains(event.target)) element.open = false; };

    document.addEventListener('pointerdown', outside);

    return () => { detach(); observer.disconnect(); document.removeEventListener('pointerdown', outside); };
  }, [controller]);

  function close() { if (details.current) details.current.open = false; }

  return <details ref={details} id="inbox" className="inbox" hidden={!view.signedIn} onToggle={(event) => { if (event.currentTarget.open) controller.open(); }} onKeyDown={(event) => {
    if (event.key !== 'Escape' || !event.currentTarget.open) return;
    event.preventDefault();
    event.stopPropagation();
    close();
    trigger.current?.focus();
  }}>
    <summary ref={trigger} id="inbox-trigger" className="corner-trigger" aria-label={view.unread ? `Inbox, ${view.unread} unread` : 'Inbox'}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 6 7.5-6" /></svg>
      <span id="inbox-count" className="inbox-count num" hidden={view.unread === 0}>{view.unread > 9 ? '9+' : view.unread}</span>
    </summary>
    <div className="corner-popover inbox-popover">
      <div className="inbox-heading"><p className="account-kicker">inbox</p><button id="inbox-clear" className="btn btn-ghost btn-sm" type="button" hidden={!view.rows.length} onClick={() => controller.clear()}>Clear</button></div>
      <p id="inbox-empty" className="account-lede" hidden={view.rows.length > 0}>Nothing here yet.</p>
      <InboxList view={view} controller={controller} close={close} />
    </div>
  </details>;
}

export function ChallengeToast({ controller }: { controller: InboxController }) {
  const view = useSyncExternalStore(controller.subscribeView, controller.getSnapshot, controller.getSnapshot);
  const row = view.toast;

  return <aside id="challenge-toast" className="toast challenge-toast" aria-label="Race notification" hidden={!row}
    onPointerEnter={() => controller.hoverToast(true)} onPointerLeave={() => controller.hoverToast(false)}
    onFocus={() => controller.holdToast()} onBlur={() => controller.blurToast()}>
    <span className="status-dot" aria-hidden="true"></span>
    <span id="challenge-toast-text">{row && <Copy parts={row.copy} />}</span>
    <button id="challenge-toast-action" className="btn btn-secondary btn-sm" type="button" hidden={!row?.action} aria-disabled={row?.waiting ? 'true' : undefined} onClick={() => { if (row) controller.act(row.entry, true); }}>{row?.action ?? ''}</button>
    <button id="challenge-toast-close" className="btn btn-ghost btn-sm toast-close" type="button" aria-label="Dismiss" onClick={() => controller.hideToast()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
    </button>
  </aside>;
}
