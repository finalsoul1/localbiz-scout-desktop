import type { Business } from "./types";

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

const columns: Array<keyof Business> = [
  "businessName",
  "businessType",
  "category",
  "roadAddress",
  "jibunAddress",
  "phone",
  "licenseDate",
  "lastModifiedDate",
  "status",
  "source",
  "placeUrl",
  "addressEnriched",
  "phoneEnriched"
];

export async function downloadCsv(items: Business[]) {
  const csv = [columns.join(","), ...items.map((item) => columns.map((column) => escapeCsv(item[column])).join(","))].join("\n");

  if ((window as TauriWindow).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("save_csv", { csv });
  }

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `localbiz-scout-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  return "브라우저 다운로드를 시작했습니다.";
}

export async function openCsvLocation(path: string) {
  if (!path || !(window as TauriWindow).__TAURI_INTERNALS__) {
    return;
  }

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_file_location", { path });
}

function escapeCsv(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}
