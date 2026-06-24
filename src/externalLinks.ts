type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export async function openExternalUrl(url: string) {
  if ((window as TauriWindow).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external_url", { url });
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    throw new Error("브라우저에서 새 창 열기가 차단되었습니다.");
  }
}
