// Bridge between the native tab bar's `tabPress` listener (in app-tabs.tsx) and
// the tab screens that own the state to reset. The NativeTabs component can't
// reach a screen's local state, so screens subscribe by tab name and the tab
// trigger emits on press. Screens themselves gate on focus so only the re-tapped
// (already-focused) tab reacts — a plain switch leaves the target unfocused at
// press time and is ignored.
type Callback = () => void;

const subscribers = new Map<string, Set<Callback>>();

export function emitTabReset(name: string) {
  subscribers.get(name)?.forEach((cb) => cb());
}

export function subscribeTabReset(name: string, cb: Callback) {
  let set = subscribers.get(name);
  if (!set) subscribers.set(name, (set = new Set()));
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}
