export type AppSettings = {
  publicDataServiceKey: string;
  kakaoRestApiKey: string;
};

export type BusinessTypeKey =
  | "all"
  | "mailOrder"
  | "doorToDoorSales"
  | "largeStore"
  | "generalRestaurant"
  | "beautySalon"
  | "pharmacy"
  | "clinic"
  | "lodging"
  | "karaokeRoom"
  | "martialArtsDojo"
  | "tobaccoRetailer";

export type SearchFilters = {
  region: string;
  regions?: string[];
  fromDate: string;
  toDate: string;
  businessType: BusinessTypeKey;
  status: "active" | "all";
  keyword: string;
  pageSize: number;
  pageNo: number;
  enabledBusinessTypes?: Array<Exclude<BusinessTypeKey, "all">>;
};

export type ApiPermissionState = "available" | "unauthorized" | "invalidKey" | "networkError" | "unknown";

export type ApiPermissionStatus = {
  businessType: Exclude<BusinessTypeKey, "all">;
  label: string;
  status: ApiPermissionState;
  serviceName: string;
  applyUrl: string;
  message: string;
};

export type StoredPermissionStatus = {
  checkedAt: string;
  statuses: ApiPermissionStatus[];
};

export type Business = {
  id: string;
  businessName: string;
  businessType: string;
  category: string;
  roadAddress: string;
  jibunAddress: string;
  phone: string;
  licenseDate: string;
  lastModifiedDate: string;
  status: string;
  source: string;
  placeUrl: string;
  addressEnriched: boolean;
  phoneEnriched: boolean;
};
