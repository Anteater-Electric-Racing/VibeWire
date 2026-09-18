/** Resolve canvas creation shortcuts without intercepting typing or other commands. */
export function getHierarchyHotkey(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'defaultPrevented' | 'isComposing'>,
  context: { isEditor: boolean; isTyping: boolean; modalOpen: boolean },
): 'device' | 'enclosure' | null {
  if (!context.isEditor || context.isTyping || context.modalOpen
    || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
    || event.repeat || event.defaultPrevented || event.isComposing) return null;
  switch (event.key.toLowerCase()) {
    case 'd': return 'device';
    case 'e': return 'enclosure';
    default: return null;
  }
}
