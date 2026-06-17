import type { ApiPermissionState, ApiPermissionStatus, AppSettings, Business, BusinessTypeKey, SearchFilters } from "./types";

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

const endpoints: Record<Exclude<BusinessTypeKey, "all">, string> = {
  mailOrder: "https://apis.data.go.kr/1741000/ecommerce_businesses/info",
  doorToDoorSales: "https://apis.data.go.kr/1741000/door_to_door_sales/info",
  largeStore: "https://apis.data.go.kr/1741000/large_scale_retail_stores/info",
  generalRestaurant: "https://apis.data.go.kr/1741000/general_restaurants/info",
  beautySalon: "https://apis.data.go.kr/1741000/beauty_salons/info",
  pharmacy: "https://apis.data.go.kr/1741000/pharmacies/info",
  clinic: "https://apis.data.go.kr/1741000/clinics/info",
  lodging: "https://apis.data.go.kr/1741000/lodgings/info",
  karaokeRoom: "https://apis.data.go.kr/1741000/karaoke_rooms/info",
  martialArtsDojo: "https://apis.data.go.kr/1741000/martial_arts_dojo/info",
  tobaccoRetailer: "https://apis.data.go.kr/1741000/tobacco_retailers/info"
};

export const businessTypeMeta: Record<Exclude<BusinessTypeKey, "all">, { label: string; serviceName: string; applyUrl: string }> = {
  mailOrder: {
    label: "통신판매업",
    serviceName: "행정안전부_생활_통신판매업 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15154963/openapi.do"
  },
  doorToDoorSales: {
    label: "방문판매업",
    serviceName: "행정안전부_생활_방문판매업 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15154956/openapi.do"
  },
  largeStore: {
    label: "대규모점포",
    serviceName: "행정안전부_생활_대규모점포 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15154948/openapi.do"
  },
  generalRestaurant: {
    label: "일반음식점",
    serviceName: "행정안전부_식품_일반음식점 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15154916/openapi.do"
  },
  beautySalon: {
    label: "미용업",
    serviceName: "행정안전부_생활_미용업 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15154918/openapi.do"
  },
  pharmacy: {
    label: "약국",
    serviceName: "행정안전부_건강_약국 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15154822/openapi.do"
  },
  clinic: {
    label: "의원",
    serviceName: "행정안전부_건강_의원 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15154874/openapi.do"
  },
  lodging: {
    label: "숙박업",
    serviceName: "행정안전부_문화_숙박업 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15155124/openapi.do"
  },
  karaokeRoom: {
    label: "노래연습장업",
    serviceName: "행정안전부_문화_노래연습장업 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15155135/openapi.do"
  },
  martialArtsDojo: {
    label: "체육도장업",
    serviceName: "행정안전부_생활_체육도장업 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15155085/openapi.do"
  },
  tobaccoRetailer: {
    label: "담배소매업",
    serviceName: "행정안전부_기타_담배소매업 조회서비스",
    applyUrl: "https://www.data.go.kr/data/15155031/openapi.do"
  }
};

const regionCodes: Record<string, string> = {
  "군포": "4020000",
  "군포시": "4020000",
  "산본": "4020000",
  "산본동": "4020000"
};

export async function searchBusinesses(settings: AppSettings, filters: SearchFilters): Promise<Business[]> {
  if (!settings.publicDataServiceKey) {
    throw new Error("PUBLIC_DATA_SERVICE_KEY가 필요합니다.");
  }

  if ((window as TauriWindow).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Business[]>("search_businesses", { settings, filters });
  }

  const targetTypes = resolveTargetTypes(filters);
  const results = await Promise.all(targetTypes.map((businessType) => fetchBusinesses(settings, filters, businessType)));
  const pageSize = Math.min(Math.max(filters.pageSize, 10), 100);
  const pageNo = Math.max(filters.pageNo, 1);
  const start = (pageNo - 1) * pageSize;
  return results
    .flat()
    .sort((left, right) => right.licenseDate.localeCompare(left.licenseDate))
    .slice(start, start + pageSize);
}

export async function exportBusinesses(settings: AppSettings, filters: SearchFilters): Promise<Business[]> {
  if (!settings.publicDataServiceKey) {
    throw new Error("PUBLIC_DATA_SERVICE_KEY가 필요합니다.");
  }

  if ((window as TauriWindow).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Business[]>("export_businesses", { settings, filters });
  }

  const targetTypes = resolveTargetTypes(filters);
  const results = await Promise.all(targetTypes.map((businessType) => fetchAllBusinesses(settings, filters, businessType)));
  return results.flat().sort((left, right) => right.licenseDate.localeCompare(left.licenseDate));
}

export async function checkApiPermissions(settings: AppSettings): Promise<ApiPermissionStatus[]> {
  if (!settings.publicDataServiceKey) {
    throw new Error("PUBLIC_DATA_SERVICE_KEY가 필요합니다.");
  }

  if ((window as TauriWindow).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ApiPermissionStatus[]>("check_api_permissions", { settings });
  }

  const businessTypes = Object.keys(endpoints) as Array<Exclude<BusinessTypeKey, "all">>;
  return Promise.all(businessTypes.map((businessType) => checkApiPermission(settings, businessType)));
}

function resolveTargetTypes(filters: SearchFilters): Array<Exclude<BusinessTypeKey, "all">> {
  if (filters.businessType !== "all") {
    return [filters.businessType];
  }

  if (filters.enabledBusinessTypes?.length) {
    return filters.enabledBusinessTypes;
  }

  return Object.keys(endpoints) as Array<Exclude<BusinessTypeKey, "all">>;
}

async function checkApiPermission(settings: AppSettings, businessType: Exclude<BusinessTypeKey, "all">): Promise<ApiPermissionStatus> {
  const meta = businessTypeMeta[businessType];
  const url = new URL(endpoints[businessType]);
  url.searchParams.set("serviceKey", settings.publicDataServiceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1");
  url.searchParams.set("returnType", "json");

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { businessType, ...meta, status: "networkError", message: `HTTP ${response.status}` };
    }

    const payload = await response.json();
    const resultCode = payload?.response?.header?.resultCode;
    const resultMsg = payload?.response?.header?.resultMsg || "";
    if (!resultCode || resultCode === "0") {
      return { businessType, ...meta, status: "available", message: "사용 가능" };
    }

    const status = classifyPermissionError(resultMsg);
    return { businessType, ...meta, status, message: resultMsg || "확인 필요" };
  } catch (caught) {
    return { businessType, ...meta, status: "networkError", message: caught instanceof Error ? caught.message : "네트워크 오류" };
  }
}

async function fetchBusinesses(
  settings: AppSettings,
  filters: SearchFilters,
  businessType: Exclude<BusinessTypeKey, "all">
): Promise<Business[]> {
  const pageSize = Math.min(Math.max(filters.pageSize, 10), 100);
  const pageNo = Math.max(filters.pageNo, 1);
  const pageResults = await Promise.all(Array.from({ length: pageNo }, (_, index) => fetchBusinessPage(settings, filters, businessType, index + 1, pageSize)));
  return pageResults.flat();
}

async function fetchBusinessPage(
  settings: AppSettings,
  filters: SearchFilters,
  businessType: Exclude<BusinessTypeKey, "all">,
  pageNo: number,
  pageSize: number
): Promise<Business[]> {
  const url = new URL(endpoints[businessType]);
  url.searchParams.set("serviceKey", settings.publicDataServiceKey);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(pageSize));
  url.searchParams.set("returnType", "json");

  const regionCode = regionCodes[filters.region];
  if (regionCode) {
    url.searchParams.set("cond[OPN_ATMY_GRP_CD::EQ]", regionCode);
  }

  if (filters.fromDate) {
    url.searchParams.set("cond[LCPMT_YMD::GTE]", compactDate(filters.fromDate));
  }

  if (filters.toDate) {
    url.searchParams.set("cond[LCPMT_YMD::LT]", nextDate(filters.toDate));
  }

  if (filters.status === "active") {
    url.searchParams.set("cond[SALS_STTS_CD::EQ]", "01");
  }

  if (filters.keyword) {
    url.searchParams.set("cond[BPLC_NM::LIKE]", filters.keyword);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`공공데이터 API 호출 실패: ${response.status}`);
  }

  const payload = await response.json();
  const resultCode = payload?.response?.header?.resultCode;
  if (resultCode && resultCode !== "0") {
    throw new Error(payload?.response?.header?.resultMsg || "공공데이터 API 오류가 발생했습니다.");
  }

  const rawItems = payload?.response?.body?.items?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  return items.map((item) => normalizeBusiness(item, businessType)).filter((business) => {
    if (!regionCodes[filters.region]) {
      return includesAny(business, filters.region, ["roadAddress", "jibunAddress", "businessName"]);
    }

    if (filters.region.includes("산본")) {
      return includesAny(business, "산본", ["roadAddress", "jibunAddress"]);
    }

    return true;
  });
}

async function fetchAllBusinesses(
  settings: AppSettings,
  filters: SearchFilters,
  businessType: Exclude<BusinessTypeKey, "all">
): Promise<Business[]> {
  const pageSize = 100;
  const firstPage = await fetchBusinessPageWithTotal(settings, filters, businessType, 1, pageSize);
  const totalPages = Math.max(1, Math.ceil(firstPage.totalCount / pageSize));
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => fetchBusinessPageWithTotal(settings, filters, businessType, index + 2, pageSize))
  );
  return [firstPage, ...remainingPages].flatMap((page) => page.items);
}

async function fetchBusinessPageWithTotal(
  settings: AppSettings,
  filters: SearchFilters,
  businessType: Exclude<BusinessTypeKey, "all">,
  pageNo: number,
  pageSize: number
): Promise<{ items: Business[]; totalCount: number }> {
  const url = new URL(endpoints[businessType]);
  url.searchParams.set("serviceKey", settings.publicDataServiceKey);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(pageSize));
  url.searchParams.set("returnType", "json");

  const regionCode = regionCodes[filters.region];
  if (regionCode) {
    url.searchParams.set("cond[OPN_ATMY_GRP_CD::EQ]", regionCode);
  }

  if (filters.fromDate) {
    url.searchParams.set("cond[LCPMT_YMD::GTE]", compactDate(filters.fromDate));
  }

  if (filters.toDate) {
    url.searchParams.set("cond[LCPMT_YMD::LT]", nextDate(filters.toDate));
  }

  if (filters.status === "active") {
    url.searchParams.set("cond[SALS_STTS_CD::EQ]", "01");
  }

  if (filters.keyword) {
    url.searchParams.set("cond[BPLC_NM::LIKE]", filters.keyword);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`공공데이터 API 호출 실패: ${response.status}`);
  }

  const payload = await response.json();
  const resultCode = payload?.response?.header?.resultCode;
  if (resultCode && resultCode !== "0") {
    throw new Error(payload?.response?.header?.resultMsg || "공공데이터 API 오류가 발생했습니다.");
  }

  const rawItems = payload?.response?.body?.items?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const totalCount = Number(payload?.response?.body?.totalCount || 0);
  return {
    items: items.map((item) => normalizeBusiness(item, businessType)).filter((business) => {
      if (!regionCodes[filters.region]) {
        return includesAny(business, filters.region, ["roadAddress", "jibunAddress", "businessName"]);
      }

      if (filters.region.includes("산본")) {
        return includesAny(business, "산본", ["roadAddress", "jibunAddress"]);
      }

      return true;
    }),
    totalCount
  };
}

function normalizeBusiness(raw: Record<string, string>, source: Exclude<BusinessTypeKey, "all">): Business {
  return {
    id: raw.MNG_NO || `${raw.BPLC_NM}-${raw.LCPMT_YMD}`,
    businessName: raw.BPLC_NM || "",
    businessType: raw.BZSTAT_SE_NM || "",
    category: raw.NTSL_MTH_NM || raw.DTL_SALS_STTS_NM || "",
    roadAddress: raw.ROAD_NM_ADDR || "",
    jibunAddress: raw.LOTNO_ADDR || "",
    phone: raw.TELNO || "",
    licenseDate: normalizeDate(raw.LCPMT_YMD),
    lastModifiedDate: normalizeDate(raw.LAST_MDFCN_PNT || raw.DAT_UPDT_PNT),
    status: normalizeStatus(raw.SALS_STTS_NM || raw.DTL_SALS_STTS_NM),
    source: `PUBLIC_DATA:${source}`,
    placeUrl: "",
    addressEnriched: false,
    phoneEnriched: false
  };
}

function compactDate(value: string) {
  return value.replaceAll(/[^0-9]/g, "");
}

function nextDate(value: string) {
  const compact = compactDate(value);
  const date = new Date(`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function normalizeDate(value: string) {
  const compact = String(value || "").replaceAll(/[^0-9]/g, "");
  if (compact.length >= 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }

  return "";
}

function normalizeStatus(value: string) {
  return value.includes("폐업") ? "closed" : "active";
}

function includesAny(business: Business, needle: string, fields: Array<keyof Business>) {
  if (!needle) {
    return true;
  }

  return fields.some((field) => String(business[field] || "").includes(needle));
}

function classifyPermissionError(message: string): ApiPermissionState {
  const normalized = message.toLowerCase();
  if (normalized.includes("service_key") || normalized.includes("인증키") || normalized.includes("등록되지 않은") || normalized.includes("invalid")) {
    return "invalidKey";
  }

  if (normalized.includes("access") || normalized.includes("denied") || normalized.includes("권한") || normalized.includes("승인") || normalized.includes("활용신청")) {
    return "unauthorized";
  }

  return "unknown";
}
