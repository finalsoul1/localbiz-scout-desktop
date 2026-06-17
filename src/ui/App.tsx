import { useEffect, useMemo, useRef, useState } from "react";
import { businessTypeMeta, checkApiPermissions, exportBusinesses, searchBusinesses } from "../businessApi";
import { downloadCsv, openCsvLocation } from "../exportCsv";
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

export function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(() => !loadSettings().publicDataServiceKey);
  const [filters, setFilters] = useState<SearchFilters>({
    region: "산본",
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
  const [toast, setToast] = useState<ToastState | null>(null);
  const [permissionStatuses, setPermissionStatuses] = useState<ApiPermissionStatus[]>(() => loadPermissionStatus()?.statuses || []);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [checkingPermissions, setCheckingPermissions] = useState(false);
  const toastTimerRef = useRef<number | null>(null);

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

    try {
      const nextPermission = nextFilters.businessType === "all" ? null : permissionStatuses.find((status) => status.businessType === nextFilters.businessType);
      if (nextPermission && nextPermission.status !== "available") {
        throw new Error("선택한 업종은 공공데이터 API 승인 상태 확인이 필요합니다.");
      }

      const result = await searchBusinesses(settings, withEnabledBusinessTypes(nextFilters));
      setItems(result);
      setFilters(nextFilters);
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
    setSettingsOpen(false);
    void refreshPermissions(nextSettings);
  }

  function handleClearSettings() {
    clearSettings();
    clearPermissionStatus();
    setSettings({ publicDataServiceKey: "", kakaoRestApiKey: "" });
    setPermissionStatuses([]);
    setPermissionsOpen(false);
    setSettingsOpen(true);
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

  async function handlePageCsvSave() {
    setSavingCsv("page");
    setError("");
    setNotice("");
    showToast({
      type: "saving",
      title: "현재 페이지 CSV 저장 중",
      message: "화면에 보이는 조회 결과를 파일로 저장하고 있습니다."
    });

    try {
      const savedPath = await downloadCsv(displayedItems);
      setNotice(`CSV 저장 완료: ${savedPath}`);
      showToast({
        type: "success",
        title: "현재 페이지 CSV 저장 완료",
        message: savedPath,
        filePath: savedPath
      });
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
      showToast({
        type: "success",
        title: "전체 결과 CSV 저장 완료",
        message: `${exportItems.length.toLocaleString("ko-KR")}건 저장 · ${savedPath}`,
        filePath: savedPath
      });
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
          <span className="brand-mark" aria-hidden="true">S</span>
          <div>
            <strong>상권스카우트</strong>
            <span>LocalBiz Scout</span>
          </div>
        </div>

        <button type="button" className="workspace-select">
          <span>군포 · 산본 조사</span>
          <span aria-hidden="true">⌄</span>
        </button>

        <div className="lnb-quick-grid" aria-label="빠른 작업">
          <button type="button" className={settingsOpen ? "active" : ""} onClick={() => setSettingsOpen(!settingsOpen)}>
            <span aria-hidden="true">⚙</span>
            설정
          </button>
          <button type="button" className={permissionsOpen ? "active" : ""} disabled={!canSearch} onClick={() => setPermissionsOpen(!permissionsOpen)}>
            <span aria-hidden="true">✓</span>
            승인
          </button>
          <button type="button" disabled={!canSearch || checkingPermissions} onClick={() => void refreshPermissions(settings)}>
            <span aria-hidden="true">↻</span>
            갱신
          </button>
        </div>

        <nav className="lnb-nav" aria-label="주 메뉴">
          <section>
            <p>조회</p>
            <a className="active" href="#search-panel">사업자 조회</a>
            <a href="#result-panel">조회 결과</a>
            <a href="#export-actions">CSV 저장</a>
          </section>
          <section>
            <p>데이터</p>
            <a href="#permission-panel">승인 상태</a>
            <a href="#settings-panel">API 설정</a>
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

      <main className="workspace">
        <header className="workspace-topbar">
          <div>
            <span className="eyebrow">지역 사업자 인허가 조회</span>
            <h1>사업자 조회</h1>
          </div>
          <div className="topbar-actions">
            <span className={checkingPermissions ? "status-pill checking" : canSearch && availableBusinessTypes.length ? "status-pill ready" : "status-pill"}>
              {checkingPermissions ? <span className="spinner tiny" aria-hidden="true" /> : null}
              {permissionSummary}
            </span>
            <div className="joined-button-group" aria-label="승인 상태">
              <button
                type="button"
                className={`secondary-button toggle-button joined-main ${permissionsOpen ? "active" : ""}`}
                aria-pressed={permissionsOpen}
                disabled={!canSearch}
                onClick={() => setPermissionsOpen(!permissionsOpen)}
              >
                승인 상태
              </button>
              <button
                type="button"
                className="secondary-button icon-button joined-side"
                disabled={!canSearch || checkingPermissions}
                onClick={() => void refreshPermissions(settings)}
                title="승인 상태 다시 확인"
                aria-label="승인 상태 다시 확인"
              >
                ↻
              </button>
            </div>
          </div>
        </header>

        <section className="summary-grid" aria-label="조회 요약">
          <SummaryCard label="표시 결과" value={summary} tone="mint" />
          <SummaryCard label="승인 업종" value={`${availableBusinessTypes.length}/${businessTypeKeys.length}개`} />
          <SummaryCard label="현재 페이지" value={`${filters.pageNo.toLocaleString("ko-KR")}페이지`} />
        </section>

        {settingsOpen ? (
          <div id="settings-panel">
            <SettingsPanel settings={settings} onSave={handleSaveSettings} onClear={handleClearSettings} onClose={() => setSettingsOpen(false)} />
          </div>
        ) : null}

        {!isTauriRuntime ? (
          <section className="notice-box">
            브라우저 개발 모드에서는 공공데이터 API의 CORS 정책 때문에 실제 조회가 실패할 수 있습니다. 실제 조회 테스트는 `npm run tauri dev`로 실행하세요.
          </section>
        ) : null}

        {permissionsOpen ? (
          <div id="permission-panel">
            <PermissionPanel statuses={permissionStatuses} checking={checkingPermissions} onRefresh={() => void refreshPermissions(settings)} />
          </div>
        ) : null}

        <section id="search-panel" className="search-card" aria-label="검색 조건">
          <div className="section-heading">
            <div>
              <h2>조회 조건</h2>
              <p>지역, 기간, 업종을 조합해 최근 인허가 순으로 확인합니다.</p>
            </div>
            <button type="button" className="primary-button" disabled={!canSearch || loading || selectedTypeBlocked} onClick={handleSearch}>
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
              지역
              <select value={filters.region} onChange={(event) => updateFilters({ region: event.target.value })}>
                <option value="산본">산본</option>
                <option value="군포">군포</option>
                <option value="군포시">군포시</option>
              </select>
            </label>
            <label>
              시작일
              <input type="date" value={filters.fromDate} onChange={(event) => updateFilters({ fromDate: event.target.value })} />
            </label>
            <label>
              종료일
              <input type="date" value={filters.toDate} onChange={(event) => updateFilters({ toDate: event.target.value })} />
            </label>
            <label>
              업종
              <select value={filters.businessType} onChange={(event) => updateFilters({ businessType: event.target.value as SearchFilters["businessType"] })}>
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
              <select value={filters.status} onChange={(event) => updateFilters({ status: event.target.value as SearchFilters["status"] })}>
                <option value="active">영업</option>
                <option value="all">전체</option>
              </select>
            </label>
            <label>
              키워드
              <input value={filters.keyword} placeholder="사업자명" onChange={(event) => updateFilters({ keyword: event.target.value })} />
            </label>
            <label>
              건수
              <input
                type="number"
                min={minPageSize}
                max={maxPageSize}
                value={pageSizeInput}
                onBlur={handlePageSizeBlur}
                onChange={(event) => handlePageSizeChange(event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="client-filter-row" aria-label="화면 필터">
          <label className="checkbox-label">
            <input type="checkbox" checked={hideMaskedAddress} onChange={(event) => setHideMaskedAddress(event.target.checked)} />
            마스킹 주소 제외
          </label>
          <span>{hideMaskedAddress ? "주소에 *가 포함된 결과를 화면과 CSV에서 제외합니다." : "공공데이터 원본 결과를 그대로 표시합니다."}</span>
        </section>

        <section id="export-actions" className="action-row">
          <div>
            <strong>{summary}</strong>
            <span>{loading ? "전체 업종을 조회하고 최근 순으로 정리하는 중" : "기본 정렬: 인허가일자 최근 순"}</span>
          </div>
          <div className="button-row">
            <button type="button" className="secondary-button" disabled={!displayedItems.length || Boolean(savingCsv)} onClick={handlePageCsvSave}>
              {savingCsv === "page" ? "저장 중" : "현재 페이지 CSV"}
            </button>
            <button type="button" className="secondary-button" disabled={!canSearch || loading || Boolean(savingCsv) || selectedTypeBlocked} onClick={handleAllCsvSave}>
              {savingCsv === "all" ? "수집 중" : "전체 결과 CSV"}
            </button>
          </div>
        </section>

        {error ? <div className="error-box">{error}</div> : null}
        {selectedTypeBlocked && selectedPermission ? <div className="error-box">{selectedPermission.label} API 승인 필요: {selectedPermission.serviceName}</div> : null}
        {notice ? <div className="success-box">{notice}</div> : null}

        <div id="result-panel">
          <BusinessTable items={displayedItems} loading={loading} hideMaskedAddress={hideMaskedAddress} />
        </div>
        <Pagination
          pageNo={filters.pageNo}
          pageSize={filters.pageSize}
          itemCount={items.length}
          loading={loading}
          canSearch={canSearch}
          onPageChange={handlePageChange}
        />

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
}

function createPermissionTimeoutStatuses(): ApiPermissionStatus[] {
  return businessTypeKeys.map((businessType) => ({
    businessType,
    ...businessTypeMeta[businessType],
    status: "networkError",
    message: "승인 상태 확인 시간이 초과되었습니다."
  }));
}

function clampPageSize(value: number) {
  return Math.min(Math.max(Math.trunc(value), minPageSize), maxPageSize);
}

function hasMaskedAddress(item: Business) {
  return item.roadAddress.includes("*") || item.jibunAddress.includes("*");
}

function SummaryCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "mint" }) {
  return (
    <article className={`summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
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
  onRefresh
}: {
  statuses: ApiPermissionStatus[];
  checking: boolean;
  onRefresh: () => void;
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
                      <a href={status.applyUrl} target="_blank" rel="noreferrer">
                        열기
                      </a>
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

function SettingsPanel({
  settings,
  onSave,
  onClear,
  onClose
}: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClear: () => void;
  onClose: () => void;
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
      {guideOpen ? <ApiKeyGuide /> : null}
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

function ApiKeyGuide() {
  return (
    <section className="api-guide" aria-label="키 발급 안내">
      <div className="guide-card">
        <div>
          <strong>1. 공공데이터포털 인증키 발급</strong>
          <p>data.go.kr 로그인 후 마이페이지에서 일반 인증키를 확인합니다.</p>
          <a href="https://www.data.go.kr/" target="_blank" rel="noreferrer">
            공공데이터포털 열기
          </a>
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
          <a href="https://developers.kakao.com/console/app" target="_blank" rel="noreferrer">
            Kakao Developers 열기
          </a>
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
