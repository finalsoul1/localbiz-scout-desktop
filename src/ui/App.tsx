import { useEffect, useMemo, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { businessTypeMeta, checkApiPermissions, exportBusinesses, regionOptions, searchBusinesses } from "../businessApi";
import { downloadCsv, openCsvLocation } from "../exportCsv";
import { openExternalUrl } from "../externalLinks";
import { clearPermissionStatus, clearSettings, loadPermissionStatus, loadSettings, maskSecret, savePermissionStatus, saveSettings } from "../storage";
import type { ApiPermissionStatus, AppSettings, Business, BusinessTypeKey, SearchFilters } from "../types";

const today = new Date().toISOString().slice(0, 10);
const isTauriRuntime = "__TAURI_INTERNALS__" in window;
const defaultPageSize = 50;
const minPageSize = 10;
const maxPageSize = 100;
const permissionCheckTimeoutMs = 15_000;
const businessTypeKeys = Object.keys(businessTypeMeta) as Array<Exclude<BusinessTypeKey, "all">>;

type ToastState = {
  type: "saving" | "success" | "error";
  title: string;
  message: string;
  filePath?: string;
};

type AppView = "business" | "export" | "permissions" | "settings" | "updates";

type UpdateState =
  | { status: "idle"; message: string }
  | { status: "checking"; message: string }
  | { status: "available"; message: string; version: string; currentVersion: string; notes?: string }
  | { status: "latest"; message: string }
  | { status: "downloading"; message: string; downloaded: number; total?: number }
  | { status: "installed"; message: string }
  | { status: "error"; message: string };

export function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [activeView, setActiveView] = useState<AppView>(() => (loadSettings().publicDataServiceKey ? "business" : "settings"));
  const [filters, setFilters] = useState<SearchFilters>({
    region: "산본",
    regions: ["산본"],
    fromDate: "2026-06-01",
    toDate: today,
    businessType: "all",
    status: "active",
    keyword: "",
    pageSize: defaultPageSize,
    pageNo: 1
  });
  const [pageSizeInput, setPageSizeInput] = useState(String(defaultPageSize));
  const [items, setItems] = useState<Business[]>([]);
  const [hideMaskedAddress, setHideMaskedAddress] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingCsv, setSavingCsv] = useState<"page" | "all" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeFilePath, setNoticeFilePath] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [permissionStatuses, setPermissionStatuses] = useState<ApiPermissionStatus[]>(() => loadPermissionStatus()?.statuses || []);
  const [checkingPermissions, setCheckingPermissions] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle", message: "업데이트 확인 전" });
  const toastTimerRef = useRef<number | null>(null);
  const pendingUpdateRef = useRef<Update | null>(null);

  const canSearch = Boolean(settings.publicDataServiceKey);
  const availableBusinessTypes = useMemo(
    () => permissionStatuses.filter((status) => status.status === "available").map((status) => status.businessType),
    [permissionStatuses]
  );
  const permissionSummary = useMemo(() => {
    if (!canSearch) {
      return "API 설정 필요";
    }

    if (checkingPermissions) {
      return "승인 확인 중";
    }

    if (!permissionStatuses.length) {
      return "승인 상태 미확인";
    }

    return `${availableBusinessTypes.length}/${businessTypeKeys.length}개 업종 사용 가능`;
  }, [availableBusinessTypes.length, canSearch, checkingPermissions, permissionStatuses.length]);
  const selectedPermission = filters.businessType === "all" ? null : permissionStatuses.find((status) => status.businessType === filters.businessType);
  const selectedTypeBlocked = Boolean(selectedPermission && selectedPermission.status !== "available");
  const displayedItems = useMemo(
    () => (hideMaskedAddress ? items.filter((item) => !hasMaskedAddress(item)) : items),
    [hideMaskedAddress, items]
  );
  const hiddenMaskedCount = items.length - displayedItems.length;
  const summary = useMemo(() => {
    if (!displayedItems.length) {
      return "조회 결과 없음";
    }

    if (hiddenMaskedCount > 0) {
      return `${displayedItems.length.toLocaleString("ko-KR")}건 표시 · 마스킹 ${hiddenMaskedCount.toLocaleString("ko-KR")}건 제외`;
    }

    return `${displayedItems.length.toLocaleString("ko-KR")}건`;
  }, [displayedItems.length, hiddenMaskedCount]);

  async function runSearch(nextFilters: SearchFilters) {
    setLoading(true);
    setError("");
    setNotice("");
    setNoticeFilePath("");

    try {
      if (!selectedRegions(nextFilters).length) {
        throw new Error("조회할 지역을 하나 이상 선택하세요.");
      }

      const nextPermission = nextFilters.businessType === "all" ? null : permissionStatuses.find((status) => status.businessType === nextFilters.businessType);
      if (nextPermission && nextPermission.status !== "available") {
        throw new Error("선택한 업종은 공공데이터 API 승인 상태 확인이 필요합니다.");
      }

      const result = await searchBusinesses(settings, withEnabledBusinessTypes(nextFilters));
      setItems(result);
      setFilters(nextFilters);
      setActiveView("business");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    void runSearch({ ...filters, pageNo: 1 });
  }

  function handlePageChange(pageNo: number) {
    void runSearch({ ...filters, pageNo: Math.max(1, pageNo) });
  }

  function updateFilters(nextFilters: Partial<SearchFilters>) {
    setFilters({ ...filters, ...nextFilters, pageNo: 1 });
  }

  function handlePageSizeChange(value: string) {
    setPageSizeInput(value);

    if (!value.trim()) {
      return;
    }

    const nextPageSize = Number(value);
    if (!Number.isFinite(nextPageSize)) {
      return;
    }

    updateFilters({ pageSize: clampPageSize(nextPageSize) });
  }

  function handlePageSizeBlur() {
    const nextPageSize = Number(pageSizeInput);
    const normalizedPageSize = Number.isFinite(nextPageSize) ? clampPageSize(nextPageSize) : defaultPageSize;
    setPageSizeInput(String(normalizedPageSize));
    updateFilters({ pageSize: normalizedPageSize });
  }

  function handleSaveSettings(nextSettings: AppSettings) {
    saveSettings(nextSettings);
    setSettings(nextSettings);
    setActiveView("business");
    void refreshPermissions(nextSettings);
  }

  function handleClearSettings() {
    clearSettings();
    clearPermissionStatus();
    setSettings({ publicDataServiceKey: "", kakaoRestApiKey: "" });
    setPermissionStatuses([]);
    setActiveView("settings");
    setItems([]);
  }

  useEffect(() => {
    if (settings.publicDataServiceKey) {
      void refreshPermissions(settings, false);
    }
  }, [settings.publicDataServiceKey]);

  async function refreshPermissions(nextSettings = settings, showSuccessToast = true) {
    if (!nextSettings.publicDataServiceKey) {
      return;
    }

    setCheckingPermissions(true);
    try {
      const statuses = await withPermissionTimeout(checkApiPermissions(nextSettings));
      setPermissionStatuses(statuses);
      savePermissionStatus({ checkedAt: new Date().toISOString(), statuses });

      if (showSuccessToast) {
        const availableCount = statuses.filter((status) => status.status === "available").length;
        showToast({
          type: "success",
          title: "승인 상태 확인 완료",
          message: `${availableCount.toLocaleString("ko-KR")}/${statuses.length.toLocaleString("ko-KR")}개 업종 사용 가능`
        });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "승인 상태 확인 중 오류가 발생했습니다.";
      showToast({
        type: "error",
        title: "승인 상태 확인 실패",
        message
      });
    } finally {
      setCheckingPermissions(false);
    }
  }

  function withPermissionTimeout(promise: Promise<ApiPermissionStatus[]>) {
    return new Promise<ApiPermissionStatus[]>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        resolve(createPermissionTimeoutStatuses());
      }, permissionCheckTimeoutMs);

      promise.then(
        (statuses) => {
          window.clearTimeout(timeoutId);
          resolve(statuses);
        },
        () => {
          window.clearTimeout(timeoutId);
          resolve(createPermissionTimeoutStatuses());
        }
      );
    });
  }

  function withEnabledBusinessTypes(nextFilters: SearchFilters): SearchFilters {
    if (nextFilters.businessType !== "all" || !availableBusinessTypes.length) {
      return nextFilters;
    }

    return { ...nextFilters, enabledBusinessTypes: availableBusinessTypes };
  }

  function showToast(nextToast: ToastState, duration = 3600) {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    setToast(nextToast);
    if (nextToast.type !== "saving") {
      toastTimerRef.current = window.setTimeout(() => setToast(null), duration);
    }
  }

  async function handleOpenExternalUrl(url: string) {
    try {
      await openExternalUrl(url);
    } catch (caught) {
      showToast({
        type: "error",
        title: "링크 열기 실패",
        message: caught instanceof Error ? caught.message : "기본 브라우저를 열지 못했습니다."
      });
    }
  }

  async function handlePageCsvSave() {
    setSavingCsv("page");
    setError("");
    setNotice("");
    setNoticeFilePath("");
    showToast({
      type: "saving",
      title: "현재 페이지 CSV 저장 중",
      message: "화면에 보이는 조회 결과를 파일로 저장하고 있습니다."
    });

    try {
      const savedPath = await downloadCsv(displayedItems);
      setNotice(`CSV 저장 완료: ${savedPath}`);
      setNoticeFilePath(savedPath);
      setToast(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "CSV 저장 중 오류가 발생했습니다.";
      setError(message);
      showToast({
        type: "error",
        title: "CSV 저장 실패",
        message
      });
    } finally {
      setSavingCsv(null);
    }
  }

  async function handleAllCsvSave() {
    setSavingCsv("all");
    setError("");
    setNotice("");
    setNoticeFilePath("");
    showToast({
      type: "saving",
      title: "전체 결과 CSV 저장 중",
      message: "공공데이터 totalCount 기준으로 마지막 페이지까지만 수집합니다."
    });

    try {
      const allItems = await collectAllSearchResults();
      const exportItems = hideMaskedAddress ? allItems.filter((item) => !hasMaskedAddress(item)) : allItems;
      if (!exportItems.length) {
        throw new Error("저장할 조회 결과가 없습니다.");
      }

      const savedPath = await downloadCsv(exportItems);
      setNotice(`전체 결과 CSV 저장 완료: ${exportItems.length.toLocaleString("ko-KR")}건 · ${savedPath}`);
      setNoticeFilePath(savedPath);
      setToast(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "CSV 저장 중 오류가 발생했습니다.";
      setError(message);
      showToast({
        type: "error",
        title: "CSV 저장 실패",
        message
      });
    } finally {
      setSavingCsv(null);
    }
  }

  async function collectAllSearchResults() {
    showToast({
      type: "saving",
      title: "전체 결과 CSV 저장 중",
      message: "전체 결과를 수집하고 있습니다."
    });

    const allItems = await exportBusinesses(settings, withEnabledBusinessTypes({ ...filters, pageNo: 1, pageSize: maxPageSize }));
    const seen = new Set<string>();
    return allItems.filter((item) => {
      const key = item.id || `${item.businessName}-${item.licenseDate}-${item.roadAddress}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  return (
    <div className="app-shell">
      <aside className="lnb" aria-label="상권스카우트 메뉴">
        <div className="brand-lockup">
          <div>
            <strong>상권스카우트</strong>
            <span>LocalBiz Scout</span>
          </div>
        </div>

        <RegionMultiSelect selectedRegions={selectedRegions(filters)} onChange={(regions) => updateFilters({ region: regions[0] || "", regions })} />

        <nav className="lnb-nav" aria-label="주 메뉴">
          <section>
            <p>조회</p>
            <button type="button" className={activeView === "business" ? "active" : ""} onClick={() => setActiveView("business")}>사업자 조회</button>
          </section>
          <section>
            <p>작업</p>
            <button type="button" className={activeView === "export" ? "active" : ""} onClick={() => setActiveView("export")}>CSV 저장</button>
            <button
              type="button"
              className={activeView === "permissions" ? "active" : ""}
              disabled={!canSearch}
              onClick={() => setActiveView("permissions")}
            >
              승인 상태
            </button>
            <button type="button" className={activeView === "settings" ? "active" : ""} onClick={() => setActiveView("settings")}>
              API 설정
            </button>
            <button type="button" className={activeView === "updates" ? "active" : ""} onClick={() => setActiveView("updates")}>
              업데이트
            </button>
          </section>
        </nav>

        <div className="lnb-status-card">
          <span className={checkingPermissions ? "status-dot checking" : canSearch && availableBusinessTypes.length ? "status-dot ready" : "status-dot"} />
          <div>
            <strong>{permissionSummary}</strong>
            <span>{settings.kakaoRestApiKey ? "Kakao 보강 켜짐" : "Kakao 보강 꺼짐"}</span>
          </div>
        </div>
      </aside>

      <main className="workspace" id="workspace-top">
        <header className="workspace-topbar">
          <div>
            <span className="eyebrow">지역 사업자 인허가 조회</span>
            <h1>{viewTitle(activeView)}</h1>
          </div>
        </header>

        {!isTauriRuntime ? (
          <section className="notice-box">
            브라우저 개발 모드에서는 공공데이터 API의 CORS 정책 때문에 실제 조회가 실패할 수 있습니다. 실제 조회 테스트는 `npm run tauri dev`로 실행하세요.
          </section>
        ) : null}

        {error ? <div className="error-box">{error}</div> : null}
        {selectedTypeBlocked && selectedPermission ? <div className="error-box">{selectedPermission.label} API 승인 필요: {selectedPermission.serviceName}</div> : null}
        {notice ? (
          <div className="success-box">
            <span>{notice}</span>
            {noticeFilePath ? (
              <button type="button" className="inline-action-button" onClick={() => void handleOpenCsvLocation(noticeFilePath)}>
                파일 위치 열기
              </button>
            ) : null}
          </div>
        ) : null}

        {activeView === "business" ? (
          <BusinessView
            filters={filters}
            pageSizeInput={pageSizeInput}
            permissionStatuses={permissionStatuses}
            summary={summary}
            pageNo={filters.pageNo}
            pageSize={filters.pageSize}
            itemCount={items.length}
            items={displayedItems}
            loading={loading}
            canSearch={canSearch}
            selectedTypeBlocked={selectedTypeBlocked}
            hideMaskedAddress={hideMaskedAddress}
            onSearch={handleSearch}
            onUpdateFilters={updateFilters}
            onPageSizeChange={handlePageSizeChange}
            onPageSizeBlur={handlePageSizeBlur}
            onHideMaskedAddressChange={setHideMaskedAddress}
            onPageChange={handlePageChange}
          />
        ) : null}

        {activeView === "export" ? (
          <ExportView
            summary={summary}
            displayedCount={displayedItems.length}
            canSearch={canSearch}
            loading={loading}
            savingCsv={savingCsv}
            selectedTypeBlocked={selectedTypeBlocked}
            hideMaskedAddress={hideMaskedAddress}
            onHideMaskedAddressChange={setHideMaskedAddress}
            onPageCsvSave={handlePageCsvSave}
            onAllCsvSave={handleAllCsvSave}
          />
        ) : null}

        {activeView === "permissions" ? (
          <PermissionPanel
            statuses={permissionStatuses}
            checking={checkingPermissions}
            onRefresh={() => void refreshPermissions(settings)}
            onOpenExternalUrl={(url) => void handleOpenExternalUrl(url)}
          />
        ) : null}

        {activeView === "settings" ? (
          <SettingsPanel
            settings={settings}
            onSave={handleSaveSettings}
            onClear={handleClearSettings}
            onClose={() => setActiveView("business")}
            onOpenExternalUrl={(url) => void handleOpenExternalUrl(url)}
          />
        ) : null}

        {activeView === "updates" ? (
          <UpdatePanel
            updateState={updateState}
            isTauriRuntime={isTauriRuntime}
            onCheck={handleCheckUpdate}
            onInstall={handleInstallUpdate}
            onRelaunch={() => void relaunch()}
          />
        ) : null}

        {toast ? <Toast toast={toast} onClose={() => setToast(null)} onOpenLocation={handleOpenCsvLocation} /> : null}
      </main>
    </div>
  );

  async function handleOpenCsvLocation(path: string) {
    try {
      await openCsvLocation(path);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "CSV 파일 위치를 열지 못했습니다.";
      showToast({
        type: "error",
        title: "파일 위치 열기 실패",
        message
      });
    }
  }

  async function handleCheckUpdate() {
    if (!isTauriRuntime) {
      setUpdateState({ status: "error", message: "브라우저 개발 모드에서는 업데이트 확인을 사용할 수 없습니다." });
      return;
    }

    pendingUpdateRef.current = null;
    setUpdateState({ status: "checking", message: "업데이트 정보를 확인하고 있습니다." });

    try {
      const nextUpdate = await check();
      if (!nextUpdate) {
        setUpdateState({ status: "latest", message: "현재 최신 버전을 사용 중입니다." });
        return;
      }

      pendingUpdateRef.current = nextUpdate;
      setUpdateState({
        status: "available",
        message: `새 버전 ${nextUpdate.version}을 설치할 수 있습니다.`,
        version: nextUpdate.version,
        currentVersion: nextUpdate.currentVersion,
        notes: nextUpdate.body
      });
    } catch (caught) {
      setUpdateState({
        status: "error",
        message: caught instanceof Error ? caught.message : "업데이트 확인 중 오류가 발생했습니다."
      });
    }
  }

  async function handleInstallUpdate() {
    const pendingUpdate = pendingUpdateRef.current;
    if (!pendingUpdate) {
      setUpdateState({ status: "error", message: "설치할 업데이트가 없습니다. 먼저 업데이트를 확인하세요." });
      return;
    }

    let downloaded = 0;
    let total: number | undefined;
    setUpdateState({ status: "downloading", message: "업데이트를 다운로드하고 있습니다.", downloaded, total });

    try {
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
          downloaded = 0;
          setUpdateState({ status: "downloading", message: "업데이트 다운로드를 시작했습니다.", downloaded, total });
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdateState({ status: "downloading", message: "업데이트를 다운로드하고 있습니다.", downloaded, total });
        }

        if (event.event === "Finished") {
          setUpdateState({ status: "downloading", message: "다운로드가 완료되어 설치 중입니다.", downloaded, total });
        }
      });

      pendingUpdateRef.current = null;
      setUpdateState({ status: "installed", message: "업데이트 설치가 완료되었습니다. 앱을 다시 시작하세요." });
    } catch (caught) {
      setUpdateState({
        status: "error",
        message: caught instanceof Error ? caught.message : "업데이트 설치 중 오류가 발생했습니다."
      });
    }
  }
}

function createPermissionTimeoutStatuses(): ApiPermissionStatus[] {
  return businessTypeKeys.map((businessType) => ({
    businessType,
    ...businessTypeMeta[businessType],
    status: "networkError",
    message: "승인 상태 확인 시간이 초과되었습니다."
  }));
}

function viewTitle(view: AppView) {
  switch (view) {
    case "export":
      return "CSV 저장";
    case "permissions":
      return "승인 상태";
    case "settings":
      return "API 설정";
    case "updates":
      return "업데이트";
    default:
      return "사업자 조회";
  }
}

function clampPageSize(value: number) {
  return Math.min(Math.max(Math.trunc(value), minPageSize), maxPageSize);
}

function hasMaskedAddress(item: Business) {
  return item.roadAddress.includes("*") || item.jibunAddress.includes("*");
}

function selectedRegions(filters: SearchFilters) {
  return filters.regions?.length ? filters.regions : filters.region ? [filters.region] : [];
}

function SummaryCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "mint" }) {
  return (
    <article className={`summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function RegionMultiSelect({ selectedRegions, onChange }: { selectedRegions: string[]; onChange: (regions: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(selectedRegions);
  const filteredOptions = regionOptions.filter((region) => region.label.includes(query.trim()));
  const summary = selectedRegions.length ? selectedRegions.join(", ") : "지역 선택";
  const countLabel = selectedRegions.length ? `${selectedRegions.length.toLocaleString("ko-KR")}개 지역 선택됨` : "조회할 지역을 선택하세요";

  function toggleRegion(region: string) {
    if (selectedSet.has(region)) {
      const nextRegions = selectedRegions.filter((selectedRegion) => selectedRegion !== region);
      onChange(nextRegions);
      return;
    }

    onChange([...selectedRegions, region]);
  }

  return (
    <section className="lnb-region-select">
      <span>지역</span>
      <button type="button" className="region-select-trigger" onClick={() => setOpen(!open)} aria-expanded={open}>
        <strong>{summary}</strong>
        <small>{countLabel}</small>
      </button>
      {open ? (
        <div className="region-popover">
          <input value={query} placeholder="지역 검색" onChange={(event) => setQuery(event.target.value)} autoFocus />
          <div className="region-chip-row">
            <button type="button" onClick={() => onChange(["산본"])}>
              산본
            </button>
            <button type="button" onClick={() => onChange(["군포"])}>
              군포
            </button>
            <button type="button" onClick={() => onChange([])}>
              전체 해제
            </button>
          </div>
          <div className="region-option-list">
            {filteredOptions.length ? (
              filteredOptions.map((region) => (
                <label key={region.label} className="region-option">
                  <input type="checkbox" checked={selectedSet.has(region.label)} onChange={() => toggleRegion(region.label)} />
                  <span>{region.label}</span>
                </label>
              ))
            ) : (
              <div className="region-empty">검색 결과 없음</div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BusinessView({
  filters,
  pageSizeInput,
  permissionStatuses,
  summary,
  pageNo,
  pageSize,
  itemCount,
  items,
  loading,
  canSearch,
  selectedTypeBlocked,
  hideMaskedAddress,
  onSearch,
  onUpdateFilters,
  onPageSizeChange,
  onPageSizeBlur,
  onHideMaskedAddressChange,
  onPageChange
}: {
  filters: SearchFilters;
  pageSizeInput: string;
  permissionStatuses: ApiPermissionStatus[];
  summary: string;
  pageNo: number;
  pageSize: number;
  itemCount: number;
  items: Business[];
  loading: boolean;
  canSearch: boolean;
  selectedTypeBlocked: boolean;
  hideMaskedAddress: boolean;
  onSearch: () => void;
  onUpdateFilters: (filters: Partial<SearchFilters>) => void;
  onPageSizeChange: (value: string) => void;
  onPageSizeBlur: () => void;
  onHideMaskedAddressChange: (nextValue: boolean) => void;
  onPageChange: (pageNo: number) => void;
}) {
  return (
    <>
      <section className="search-card" aria-label="검색 조건">
        <div className="section-heading">
          <div>
            <h2>조회 조건</h2>
            <p>지역은 왼쪽 메뉴에서 선택하고, 기간과 업종 조건을 조합해 조회합니다.</p>
          </div>
          <button type="button" className="primary-button" disabled={!canSearch || loading || selectedTypeBlocked} onClick={onSearch}>
            {loading ? (
              <span className="button-loading">
                <span className="spinner small" aria-hidden="true" />
                조회 중
              </span>
            ) : (
              "조회"
            )}
          </button>
        </div>
        <div className="toolbar">
          <label>
            시작일
            <input type="date" value={filters.fromDate} onChange={(event) => onUpdateFilters({ fromDate: event.target.value })} />
          </label>
          <label>
            종료일
            <input type="date" value={filters.toDate} onChange={(event) => onUpdateFilters({ toDate: event.target.value })} />
          </label>
          <label>
            업종
            <select value={filters.businessType} onChange={(event) => onUpdateFilters({ businessType: event.target.value as SearchFilters["businessType"] })}>
              <option value="all">전체 업종</option>
              {businessTypeKeys.map((businessType) => {
                const status = permissionStatuses.find((item) => item.businessType === businessType);
                return (
                  <option key={businessType} value={businessType}>
                    {businessTypeMeta[businessType].label}
                    {status && status.status !== "available" ? " (승인 필요)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            상태
            <select value={filters.status} onChange={(event) => onUpdateFilters({ status: event.target.value as SearchFilters["status"] })}>
              <option value="active">영업</option>
              <option value="all">전체</option>
            </select>
          </label>
          <label>
            키워드
            <input value={filters.keyword} placeholder="사업자명" onChange={(event) => onUpdateFilters({ keyword: event.target.value })} />
          </label>
          <label>
            건수
            <input
              type="number"
              min={minPageSize}
              max={maxPageSize}
              value={pageSizeInput}
              onBlur={onPageSizeBlur}
              onChange={(event) => onPageSizeChange(event.target.value)}
            />
          </label>
        </div>
      </section>
      <ResultControls summary={summary} hideMaskedAddress={hideMaskedAddress} onHideMaskedAddressChange={onHideMaskedAddressChange} />
      <BusinessTable items={items} loading={loading} hideMaskedAddress={hideMaskedAddress} />
      <Pagination pageNo={pageNo} pageSize={pageSize} itemCount={itemCount} loading={loading} canSearch={canSearch} onPageChange={onPageChange} />
    </>
  );
}

function ExportView({
  summary,
  displayedCount,
  canSearch,
  loading,
  savingCsv,
  selectedTypeBlocked,
  hideMaskedAddress,
  onHideMaskedAddressChange,
  onPageCsvSave,
  onAllCsvSave
}: {
  summary: string;
  displayedCount: number;
  canSearch: boolean;
  loading: boolean;
  savingCsv: "page" | "all" | null;
  selectedTypeBlocked: boolean;
  hideMaskedAddress: boolean;
  onHideMaskedAddressChange: (nextValue: boolean) => void;
  onPageCsvSave: () => void;
  onAllCsvSave: () => void;
}) {
  return (
    <>
      <section className="export-panel">
        <div className="section-heading">
          <div>
            <h2>CSV 저장</h2>
            <p>현재 페이지 또는 현재 조회 조건의 전체 결과를 CSV 파일로 저장합니다.</p>
          </div>
        </div>
        <div className="export-summary">
          <SummaryCard label="저장 대상" value={summary} tone="mint" />
        </div>
        <MaskedAddressFilter hideMaskedAddress={hideMaskedAddress} onChange={onHideMaskedAddressChange} />
        <div className="button-row">
          <button type="button" className="secondary-button" disabled={!displayedCount || Boolean(savingCsv)} onClick={onPageCsvSave}>
            {savingCsv === "page" ? "저장 중" : "현재 페이지 CSV"}
          </button>
          <button type="button" className="secondary-button" disabled={!canSearch || loading || Boolean(savingCsv) || selectedTypeBlocked} onClick={onAllCsvSave}>
            {savingCsv === "all" ? "수집 중" : "전체 결과 CSV"}
          </button>
        </div>
      </section>
    </>
  );
}

function ResultControls({
  summary,
  hideMaskedAddress,
  onHideMaskedAddressChange
}: {
  summary: string;
  hideMaskedAddress: boolean;
  onHideMaskedAddressChange: (nextValue: boolean) => void;
}) {
  return (
    <section className="result-controls" aria-label="결과 옵션">
      <div className="result-count">
        <span>표시 결과</span>
        <strong>{summary}</strong>
      </div>
      <MaskedAddressFilter hideMaskedAddress={hideMaskedAddress} onChange={onHideMaskedAddressChange} compact />
    </section>
  );
}

function MaskedAddressFilter({ hideMaskedAddress, onChange, compact = false }: { hideMaskedAddress: boolean; onChange: (nextValue: boolean) => void; compact?: boolean }) {
  return (
    <div className={compact ? "client-filter-inline" : "client-filter-row"} aria-label="화면 필터">
      <label className="checkbox-label">
        <input type="checkbox" checked={hideMaskedAddress} onChange={(event) => onChange(event.target.checked)} />
        마스킹 주소 제외
      </label>
      {!compact ? <span>{hideMaskedAddress ? "주소에 *가 포함된 결과를 화면과 CSV에서 제외합니다." : "공공데이터 원본 결과를 그대로 표시합니다."}</span> : null}
    </div>
  );
}

function Pagination({
  pageNo,
  pageSize,
  itemCount,
  loading,
  canSearch,
  onPageChange
}: {
  pageNo: number;
  pageSize: number;
  itemCount: number;
  loading: boolean;
  canSearch: boolean;
  onPageChange: (pageNo: number) => void;
}) {
  const hasNext = itemCount >= pageSize;
  const pageNumbers = buildPageNumbers(pageNo, hasNext);

  return (
    <section className="pagination-bar" aria-label="페이지 이동">
      <button type="button" className="secondary-button" disabled={!canSearch || loading || pageNo <= 1} onClick={() => onPageChange(pageNo - 1)}>
        이전
      </button>
      <div className="page-number-row">
        {pageNumbers.map((pageNumber, index) =>
          pageNumber === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="pagination-ellipsis">
              ...
            </span>
          ) : (
            <button
              key={pageNumber}
              type="button"
              className={`page-number-button ${pageNumber === pageNo ? "active" : ""}`}
              disabled={!canSearch || loading || pageNumber === pageNo}
              onClick={() => onPageChange(pageNumber)}
              aria-current={pageNumber === pageNo ? "page" : undefined}
            >
              {pageNumber.toLocaleString("ko-KR")}
            </button>
          )
        )}
      </div>
      <button type="button" className="secondary-button" disabled={!canSearch || loading || !hasNext} onClick={() => onPageChange(pageNo + 1)}>
        다음
      </button>
    </section>
  );
}

function buildPageNumbers(pageNo: number, hasNext: boolean): Array<number | "ellipsis"> {
  const lastKnownPage = hasNext ? pageNo + 1 : pageNo;
  const startPage = Math.max(1, pageNo - 2);
  const endPage = Math.max(lastKnownPage, Math.min(pageNo + 2, lastKnownPage));
  const pages = new Set<number>([1]);

  for (let page = startPage; page <= endPage; page += 1) {
    pages.add(page);
  }

  if (hasNext) {
    pages.add(pageNo + 1);
  }

  const sortedPages = Array.from(pages).filter((page) => page >= 1).sort((left, right) => left - right);
  const result: Array<number | "ellipsis"> = [];

  sortedPages.forEach((page, index) => {
    const previousPage = sortedPages[index - 1];
    if (previousPage && page - previousPage > 1) {
      result.push("ellipsis");
    }

    result.push(page);
  });

  return result;
}

function Toast({ toast, onClose, onOpenLocation }: { toast: ToastState; onClose: () => void; onOpenLocation: (path: string) => void }) {
  return (
    <aside className={`toast toast-${toast.type}`} role="status" aria-live="polite">
      <div className="toast-icon">{toast.type === "success" ? "✓" : toast.type === "error" ? "!" : "…"}</div>
      <div>
        <strong>{toast.title}</strong>
        <p>{toast.message}</p>
        {toast.type === "success" && toast.filePath ? (
          <button type="button" className="toast-action" onClick={() => onOpenLocation(toast.filePath || "")}>
            파일 위치 열기
          </button>
        ) : null}
      </div>
      <button type="button" className="toast-close" onClick={onClose} aria-label="토스트 닫기">
        ×
      </button>
    </aside>
  );
}

function PermissionPanel({
  statuses,
  checking,
  onRefresh,
  onOpenExternalUrl
}: {
  statuses: ApiPermissionStatus[];
  checking: boolean;
  onRefresh: () => void;
  onOpenExternalUrl: (url: string) => void;
}) {
  const availableCount = statuses.filter((status) => status.status === "available").length;

  return (
    <section className={`permission-panel ${checking ? "checking" : ""}`}>
      <div className="permission-panel-header">
        <div>
          <h2>공공데이터 승인 상태</h2>
          <p>
            {checking
              ? "업종별 API 권한을 확인하고 있습니다. 잠시만 기다려주세요."
              : statuses.length
              ? `${availableCount.toLocaleString("ko-KR")}/${statuses.length.toLocaleString("ko-KR")}개 업종 사용 가능`
              : "아직 승인 상태를 확인하지 않았습니다."}
          </p>
        </div>
        <button type="button" className="secondary-button" disabled={checking} onClick={onRefresh}>
          {checking ? (
            <span className="button-loading">
              <span className="spinner small dark" aria-hidden="true" />
              확인 중
            </span>
          ) : (
            "다시 확인"
          )}
        </button>
      </div>
      {checking ? <div className="permission-progress" aria-hidden="true" /> : null}
      <div className="permission-table-wrap">
        <table className="permission-table">
          <thead>
            <tr>
              <th>업종</th>
              <th>상태</th>
              <th>필요한 서비스</th>
              <th>신청</th>
            </tr>
          </thead>
          <tbody>
            {statuses.length ? (
              statuses.map((status) => (
                <tr key={status.businessType}>
                  <td>{status.label}</td>
                  <td>
                    <span className={`permission-badge ${status.status}`}>{permissionStatusLabel(status.status)}</span>
                  </td>
                  <td>
                    <strong>{status.serviceName}</strong>
                    <small>{status.message}</small>
                  </td>
                  <td>
                    {status.status === "available" ? (
                      "-"
                    ) : (
                      <div className="permission-actions">
                        <button type="button" className="text-link-button" onClick={() => onOpenExternalUrl(status.applyUrl)}>
                          서비스 상세
                        </button>
                        {status.status === "networkError" || status.status === "invalidKey" ? (
                          <button type="button" className="text-link-button" onClick={() => onOpenExternalUrl("https://www.data.go.kr/iim/api/selectAcountList.do")}>
                            신청 내역 점검
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-cell" colSpan={4}>
                  공공데이터 키를 저장하면 앱 실행 시 자동으로 확인합니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function permissionStatusLabel(status: ApiPermissionStatus["status"]) {
  switch (status) {
    case "available":
      return "사용 가능";
    case "unauthorized":
      return "승인 필요";
    case "invalidKey":
      return "키 확인";
    case "networkError":
      return "확인 실패";
    default:
      return "확인 필요";
  }
}

function UpdatePanel({
  updateState,
  isTauriRuntime,
  onCheck,
  onInstall,
  onRelaunch
}: {
  updateState: UpdateState;
  isTauriRuntime: boolean;
  onCheck: () => void;
  onInstall: () => void;
  onRelaunch: () => void;
}) {
  const canInstall = updateState.status === "available";
  const progressPercent =
    updateState.status === "downloading" && updateState.total
      ? Math.min(100, Math.round((updateState.downloaded / updateState.total) * 100))
      : null;

  return (
    <section className="update-panel">
      <div className="section-heading">
        <div>
          <h2>앱 업데이트</h2>
          <p>GitHub Releases의 updater manifest를 확인하고, 새 버전이 있으면 다운로드 후 설치합니다.</p>
        </div>
        <button type="button" className="secondary-button" disabled={!isTauriRuntime || updateState.status === "checking" || updateState.status === "downloading"} onClick={onCheck}>
          {updateState.status === "checking" ? "확인 중" : "업데이트 확인"}
        </button>
      </div>

      <div className={`update-status update-${updateState.status}`}>
        <strong>{updateStatusTitle(updateState)}</strong>
        <span>{updateState.message}</span>
        {updateState.status === "available" ? (
          <dl>
            <div>
              <dt>현재 버전</dt>
              <dd>{updateState.currentVersion}</dd>
            </div>
            <div>
              <dt>새 버전</dt>
              <dd>{updateState.version}</dd>
            </div>
          </dl>
        ) : null}
        {updateState.status === "available" && updateState.notes ? <p>{updateState.notes}</p> : null}
        {updateState.status === "downloading" ? (
          <div className="update-progress" aria-label="업데이트 다운로드 진행률">
            <div style={{ width: `${progressPercent ?? 20}%` }} />
            <span>
              {progressPercent !== null
                ? `${progressPercent}%`
                : `${updateState.downloaded.toLocaleString("ko-KR")} bytes 다운로드됨`}
            </span>
          </div>
        ) : null}
      </div>

      {!isTauriRuntime ? <div className="notice-box">업데이트 확인은 설치된 데스크톱 앱에서만 사용할 수 있습니다.</div> : null}

      <div className="button-row">
        <button type="button" className="primary-button" disabled={!canInstall} onClick={onInstall}>
          다운로드 및 설치
        </button>
        <button type="button" className="secondary-button" disabled={updateState.status !== "installed"} onClick={onRelaunch}>
          앱 다시 시작
        </button>
      </div>
    </section>
  );
}

function updateStatusTitle(updateState: UpdateState) {
  switch (updateState.status) {
    case "checking":
      return "업데이트 확인 중";
    case "available":
      return "새 버전 있음";
    case "latest":
      return "최신 버전";
    case "downloading":
      return "다운로드 중";
    case "installed":
      return "설치 완료";
    case "error":
      return "업데이트 오류";
    default:
      return "업데이트 대기";
  }
}

function SettingsPanel({
  settings,
  onSave,
  onClear,
  onClose,
  onOpenExternalUrl
}: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClear: () => void;
  onClose: () => void;
  onOpenExternalUrl: (url: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [guideOpen, setGuideOpen] = useState(() => !settings.publicDataServiceKey);
  const canSave = Boolean(draft.publicDataServiceKey.trim());

  useEffect(() => {
    setDraft(settings);
    if (!settings.publicDataServiceKey) {
      setGuideOpen(true);
    }
  }, [settings]);

  return (
    <section className="settings-panel">
      <div>
        <h2>API 설정</h2>
        <p>공공데이터 키는 필수, Kakao 키는 주소/연락처 보강용 선택값입니다. 키는 이 기기 로컬 저장소에만 저장됩니다.</p>
      </div>
      <div className="settings-help-toggle">
        <button type="button" className={`secondary-button toggle-button ${guideOpen ? "active" : ""}`} aria-pressed={guideOpen} onClick={() => setGuideOpen(!guideOpen)}>
          키 발급 안내
        </button>
        <span>처음 쓰는 사람은 공공데이터 키 발급과 업종별 활용신청이 필요합니다.</span>
      </div>
      {guideOpen ? <ApiKeyGuide onOpenExternalUrl={onOpenExternalUrl} /> : null}
      <div className="settings-grid">
        <label>
          공공데이터포털 인증키 (필수)
          <input
            type="password"
            value={draft.publicDataServiceKey}
            placeholder="PUBLIC_DATA_SERVICE_KEY"
            onChange={(event) => setDraft({ ...draft, publicDataServiceKey: event.target.value })}
          />
        </label>
        <label>
          Kakao REST API Key (선택)
          <input
            type="password"
            value={draft.kakaoRestApiKey}
            placeholder="비워두면 Kakao 보강을 건너뜁니다."
            onChange={(event) => setDraft({ ...draft, kakaoRestApiKey: event.target.value })}
          />
        </label>
      </div>
      <div className="settings-footer">
        <span>현재: 공공데이터 {maskSecret(settings.publicDataServiceKey)} · Kakao 보강 {settings.kakaoRestApiKey ? maskSecret(settings.kakaoRestApiKey) : "꺼짐"}</span>
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="secondary-button" onClick={onClear}>
            키 삭제
          </button>
          <button type="button" className="primary-button" disabled={!canSave} onClick={() => onSave(draft)}>
            저장
          </button>
        </div>
      </div>
    </section>
  );
}

function ApiKeyGuide({ onOpenExternalUrl }: { onOpenExternalUrl: (url: string) => void }) {
  return (
    <section className="api-guide" aria-label="키 발급 안내">
      <div className="guide-card">
        <div>
          <strong>1. 공공데이터포털 인증키 발급</strong>
          <p>data.go.kr 로그인 후 마이페이지에서 일반 인증키를 확인합니다.</p>
          <button type="button" className="text-link-button" onClick={() => onOpenExternalUrl("https://www.data.go.kr/iim/api/selectAcountList.do")}>
            인증키 확인 페이지 열기
          </button>
        </div>
        <div className="guide-shot public-data-shot" aria-label="공공데이터포털 화면 예시">
          <div className="shot-topbar">data.go.kr</div>
          <div className="shot-line wide" />
          <div className="shot-line" />
          <div className="shot-highlight">마이페이지 · 인증키 확인</div>
        </div>
      </div>

      <div className="guide-card">
        <div>
          <strong>2. 업종별 조회서비스 활용신청</strong>
          <p>필요한 업종 API를 각각 활용신청해야 합니다. 승인 상태 화면에서 빠진 업종과 신청 링크를 확인할 수 있습니다.</p>
          <small>예: 일반음식점, 미용업, 약국, 의원, 숙박업, 노래연습장업, 체육도장업, 담배소매업</small>
          <button type="button" className="text-link-button guide-link-button" onClick={() => onOpenExternalUrl("https://www.data.go.kr/iim/api/selectAcountList.do")}>
            활용신청 내역 열기
          </button>
        </div>
        <div className="guide-shot apply-shot" aria-label="활용신청 화면 예시">
          <div className="shot-topbar">OpenAPI 상세</div>
          <div className="shot-line wide" />
          <div className="shot-button">활용신청</div>
          <div className="shot-caption">신청 후 승인 상태 다시 확인</div>
        </div>
      </div>

      <div className="guide-card">
        <div>
          <strong>3. Kakao REST API Key (선택)</strong>
          <p>Kakao Developers에서 앱을 만들고 REST API Key를 복사합니다. 비워두면 주소/연락처 보강만 건너뜁니다.</p>
          <button type="button" className="text-link-button" onClick={() => onOpenExternalUrl("https://developers.kakao.com/console/app")}>
            Kakao Developers 열기
          </button>
        </div>
        <div className="guide-shot kakao-shot" aria-label="Kakao Developers 화면 예시">
          <div className="shot-topbar">Kakao Developers</div>
          <div className="shot-line wide" />
          <div className="shot-highlight">앱 키 · REST API 키</div>
          <div className="shot-line short" />
        </div>
      </div>
    </section>
  );
}

function BusinessTable({ items, loading, hideMaskedAddress }: { items: Business[]; loading: boolean; hideMaskedAddress: boolean }) {
  return (
    <section className={`table-wrap ${loading ? "is-loading" : ""}`} aria-busy={loading}>
      {loading ? (
        <div className="loading-overlay" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <strong>조회 중</strong>
          <span>공공데이터 API와 주소 보강 결과를 불러오고 있습니다.</span>
        </div>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>사업자명</th>
            <th>업종</th>
            <th>주소</th>
            <th>연락처</th>
            <th>인허가일자</th>
            <th>상태</th>
            <th>출처</th>
            <th>보강</th>
          </tr>
        </thead>
        <tbody>
          {items.length ? (
            items.map((item) => (
              <tr key={item.id}>
                <td className="name-cell">{item.businessName}</td>
                <td>{item.businessType || item.category}</td>
                <td>
                  <div>{item.roadAddress}</div>
                  <small>{item.jibunAddress}</small>
                </td>
                <td>{item.phone || "-"}</td>
                <td>{item.licenseDate}</td>
                <td>{item.status === "active" ? "영업" : "폐업"}</td>
                <td>{item.source}</td>
                <td>
                  <div className="enrichment-tags">
                    {item.addressEnriched ? <span>주소</span> : null}
                    {item.phoneEnriched ? <span>연락처</span> : null}
                    {!item.addressEnriched && !item.phoneEnriched ? "-" : null}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="empty-cell" colSpan={8}>
                {hideMaskedAddress ? "마스킹 주소 제외 조건에 맞는 결과가 없습니다." : "조건을 입력하고 조회를 실행하세요."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
