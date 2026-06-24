import type { AppSettings, StoredPermissionStatus } from "./types";

const SETTINGS_KEY = "localbiz-scout.settings.v1";
const PERMISSION_STATUS_KEY = "localbiz-scout.permissionStatus.v1";

export function loadSettings(): AppSettings {
  const fallback: AppSettings = {
    publicDataServiceKey: "",
    kakaoRestApiKey: "",
    autoUpdateEnabled: true
  };

  try {
    const stored = window.localStorage.getItem(SETTINGS_KEY);
    return stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: AppSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function clearSettings() {
  window.localStorage.removeItem(SETTINGS_KEY);
  window.localStorage.removeItem(PERMISSION_STATUS_KEY);
}

export function loadPermissionStatus(): StoredPermissionStatus | null {
  try {
    const stored = window.localStorage.getItem(PERMISSION_STATUS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function savePermissionStatus(status: StoredPermissionStatus) {
  window.localStorage.setItem(PERMISSION_STATUS_KEY, JSON.stringify(status));
}

export function clearPermissionStatus() {
  window.localStorage.removeItem(PERMISSION_STATUS_KEY);
}

export function maskSecret(value: string) {
  if (!value) {
    return "미설정";
  }

  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
