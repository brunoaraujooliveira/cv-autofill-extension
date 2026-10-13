import { useEffect, useState } from 'preact/hooks';

/** `?tabId=` pins the panel to a tab; used when the panel is opened as a regular page. */
function pinnedTabId(): number | null {
  const value = Number(new URLSearchParams(location.search).get('tabId'));
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function queryActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

/** Id of the tab the side panel is next to, following tab switches in its window. */
export function useActiveTabId(): number | null {
  const [tabId, setTabId] = useState<number | null>(pinnedTabId);

  useEffect(() => {
    if (pinnedTabId() !== null) return undefined;
    const refresh = () => {
      queryActiveTabId()
        .then(setTabId)
        .catch(() => {
          setTabId(null);
        });
    };
    refresh();
    chrome.tabs.onActivated.addListener(refresh);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
    };
  }, []);

  return tabId;
}
