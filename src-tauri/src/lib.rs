use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    public_data_service_key: String,
    kakao_rest_api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchFilters {
    region: String,
    #[serde(default)]
    regions: Vec<String>,
    from_date: String,
    to_date: String,
    business_type: String,
    status: String,
    keyword: String,
    page_size: u16,
    page_no: u16,
    #[serde(default)]
    enabled_business_types: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Business {
    id: String,
    business_name: String,
    business_type: String,
    category: String,
    road_address: String,
    jibun_address: String,
    phone: String,
    license_date: String,
    last_modified_date: String,
    status: String,
    source: String,
    place_url: String,
    address_enriched: bool,
    phone_enriched: bool,
}

struct BusinessPage {
    businesses: Vec<Business>,
    total_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiPermissionStatus {
    business_type: String,
    label: String,
    status: String,
    service_name: String,
    apply_url: String,
    message: String,
}

#[derive(Clone, Copy)]
struct EndpointSpec {
    key: &'static str,
    label: &'static str,
    url: &'static str,
    service_name: &'static str,
    apply_url: &'static str,
}

const ENDPOINTS: &[EndpointSpec] = &[
    EndpointSpec {
        key: "mailOrder",
        label: "통신판매업",
        url: "https://apis.data.go.kr/1741000/ecommerce_businesses/info",
        service_name: "행정안전부_생활_통신판매업 조회서비스",
        apply_url: "https://www.data.go.kr/data/15154963/openapi.do",
    },
    EndpointSpec {
        key: "doorToDoorSales",
        label: "방문판매업",
        url: "https://apis.data.go.kr/1741000/door_to_door_sales/info",
        service_name: "행정안전부_생활_방문판매업 조회서비스",
        apply_url: "https://www.data.go.kr/data/15154956/openapi.do",
    },
    EndpointSpec {
        key: "largeStore",
        label: "대규모점포",
        url: "https://apis.data.go.kr/1741000/large_scale_retail_stores/info",
        service_name: "행정안전부_생활_대규모점포 조회서비스",
        apply_url: "https://www.data.go.kr/data/15154948/openapi.do",
    },
    EndpointSpec {
        key: "generalRestaurant",
        label: "일반음식점",
        url: "https://apis.data.go.kr/1741000/general_restaurants/info",
        service_name: "행정안전부_식품_일반음식점 조회서비스",
        apply_url: "https://www.data.go.kr/data/15154916/openapi.do",
    },
    EndpointSpec {
        key: "beautySalon",
        label: "미용업",
        url: "https://apis.data.go.kr/1741000/beauty_salons/info",
        service_name: "행정안전부_생활_미용업 조회서비스",
        apply_url: "https://www.data.go.kr/data/15154918/openapi.do",
    },
    EndpointSpec {
        key: "pharmacy",
        label: "약국",
        url: "https://apis.data.go.kr/1741000/pharmacies/info",
        service_name: "행정안전부_건강_약국 조회서비스",
        apply_url: "https://www.data.go.kr/data/15154822/openapi.do",
    },
    EndpointSpec {
        key: "clinic",
        label: "의원",
        url: "https://apis.data.go.kr/1741000/clinics/info",
        service_name: "행정안전부_건강_의원 조회서비스",
        apply_url: "https://www.data.go.kr/data/15154874/openapi.do",
    },
    EndpointSpec {
        key: "lodging",
        label: "숙박업",
        url: "https://apis.data.go.kr/1741000/lodgings/info",
        service_name: "행정안전부_문화_숙박업 조회서비스",
        apply_url: "https://www.data.go.kr/data/15155124/openapi.do",
    },
    EndpointSpec {
        key: "karaokeRoom",
        label: "노래연습장업",
        url: "https://apis.data.go.kr/1741000/karaoke_rooms/info",
        service_name: "행정안전부_문화_노래연습장업 조회서비스",
        apply_url: "https://www.data.go.kr/data/15155135/openapi.do",
    },
    EndpointSpec {
        key: "martialArtsDojo",
        label: "체육도장업",
        url: "https://apis.data.go.kr/1741000/martial_arts_dojo/info",
        service_name: "행정안전부_생활_체육도장업 조회서비스",
        apply_url: "https://www.data.go.kr/data/15155085/openapi.do",
    },
    EndpointSpec {
        key: "tobaccoRetailer",
        label: "담배소매업",
        url: "https://apis.data.go.kr/1741000/tobacco_retailers/info",
        service_name: "행정안전부_기타_담배소매업 조회서비스",
        apply_url: "https://www.data.go.kr/data/15155031/openapi.do",
    },
];

#[tauri::command]
async fn search_businesses(settings: AppSettings, filters: SearchFilters) -> Result<Vec<Business>, String> {
    if settings.public_data_service_key.trim().is_empty() {
        return Err("PUBLIC_DATA_SERVICE_KEY가 필요합니다.".to_string());
    }

    let client = reqwest::Client::new();
    let target_endpoints = target_endpoints(&filters)?;
    let target_regions = target_regions(&filters);

    let mut businesses = Vec::new();
    let mut errors = Vec::new();

    for endpoint in target_endpoints {
        for region in &target_regions {
            match fetch_businesses(&client, &settings, &filters, endpoint, region).await {
                Ok(mut items) => businesses.append(&mut items),
                Err(error) => errors.push(format!("{} · {}: {error}", region, endpoint.label)),
            }
        }
    }

    if businesses.is_empty() && !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    let page_size = filters.page_size.clamp(10, 100) as usize;
    let page_no = filters.page_no.max(1) as usize;
    let start = (page_no - 1) * page_size;

    businesses = dedupe_businesses(businesses);
    businesses.sort_by(|left, right| right.license_date.cmp(&left.license_date));
    let mut page_items: Vec<Business> = businesses
        .into_iter()
        .skip(start)
        .take(page_size)
        .collect();

    enrich_businesses_with_kakao(&client, &settings.kakao_rest_api_key, &mut page_items).await;
    Ok(page_items)
}

#[tauri::command]
async fn export_businesses(settings: AppSettings, filters: SearchFilters) -> Result<Vec<Business>, String> {
    if settings.public_data_service_key.trim().is_empty() {
        return Err("PUBLIC_DATA_SERVICE_KEY가 필요합니다.".to_string());
    }

    let client = reqwest::Client::new();
    let target_endpoints = target_endpoints(&filters)?;
    let target_regions = target_regions(&filters);

    let mut businesses = Vec::new();
    let mut errors = Vec::new();

    for endpoint in target_endpoints {
        for region in &target_regions {
            match fetch_all_businesses(&client, &settings, &filters, endpoint, region).await {
                Ok(mut items) => businesses.append(&mut items),
                Err(error) => errors.push(format!("{} · {}: {error}", region, endpoint.label)),
            }
        }
    }

    if businesses.is_empty() && !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    businesses = dedupe_businesses(businesses);
    businesses.sort_by(|left, right| right.license_date.cmp(&left.license_date));
    enrich_businesses_with_kakao(&client, &settings.kakao_rest_api_key, &mut businesses).await;
    Ok(businesses)
}

#[tauri::command]
async fn check_api_permissions(settings: AppSettings) -> Result<Vec<ApiPermissionStatus>, String> {
    if settings.public_data_service_key.trim().is_empty() {
        return Err("PUBLIC_DATA_SERVICE_KEY가 필요합니다.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("권한 진단 HTTP 클라이언트 생성 실패: {error}"))?;
    let service_key = settings.public_data_service_key.clone();
    let mut tasks = Vec::new();
    for endpoint in ENDPOINTS {
        let client = client.clone();
        let service_key = service_key.clone();
        let endpoint = *endpoint;
        tasks.push((
            endpoint,
            tauri::async_runtime::spawn(async move {
                check_api_permission(&client, &service_key, endpoint).await
            }),
        ));
    }

    let mut statuses = Vec::new();
    for (endpoint, task) in tasks {
        match task.await {
            Ok(status) => statuses.push(status),
            Err(error) => statuses.push(permission_status(
                endpoint,
                "networkError",
                format!("권한 진단 작업 실패: {error}"),
            )),
        }
    }

    Ok(statuses)
}

async fn check_api_permission(
    client: &reqwest::Client,
    service_key: &str,
    endpoint: EndpointSpec,
) -> ApiPermissionStatus {
    let result = client
        .get(endpoint.url)
        .query(&[
            ("serviceKey", service_key),
            ("pageNo", "1"),
            ("numOfRows", "1"),
            ("returnType", "json"),
        ])
        .send()
        .await;

    match result {
        Ok(response) if response.status().is_success() => match response.json::<Value>().await {
            Ok(payload) => permission_status_from_payload(endpoint, &payload),
            Err(error) => permission_status(endpoint, "unknown", format!("응답 파싱 실패: {error}")),
        },
        Ok(response) => permission_status(endpoint, "networkError", format!("HTTP {}", response.status())),
        Err(error) => permission_status(endpoint, "networkError", error.to_string()),
    }
}

async fn fetch_businesses(
    client: &reqwest::Client,
    settings: &AppSettings,
    filters: &SearchFilters,
    endpoint: EndpointSpec,
    region: &str,
) -> Result<Vec<Business>, String> {
    let page_size = filters.page_size.clamp(10, 100);
    let page_no = filters.page_no.max(1);
    let mut businesses = Vec::new();

    for page in 1..=page_no {
        let mut business_page = fetch_business_page(client, settings, filters, endpoint, region, page, page_size).await?;
        businesses.append(&mut business_page.businesses);
    }

    Ok(businesses)
}

async fn fetch_all_businesses(
    client: &reqwest::Client,
    settings: &AppSettings,
    filters: &SearchFilters,
    endpoint: EndpointSpec,
    region: &str,
) -> Result<Vec<Business>, String> {
    let page_size = 100;
    let mut first_page = fetch_business_page(client, settings, filters, endpoint, region, 1, page_size).await?;
    let total_pages = total_pages(first_page.total_count, page_size as usize);
    let mut businesses = Vec::new();
    businesses.append(&mut first_page.businesses);

    for page in 2..=total_pages {
        let mut business_page = fetch_business_page(client, settings, filters, endpoint, region, page, page_size).await?;
        businesses.append(&mut business_page.businesses);
    }

    Ok(businesses)
}

async fn fetch_business_page(
    client: &reqwest::Client,
    settings: &AppSettings,
    filters: &SearchFilters,
    endpoint: EndpointSpec,
    region: &str,
    page_no: u16,
    page_size: u16,
) -> Result<BusinessPage, String> {
    let mut request = client
        .get(endpoint.url)
        .query(&[
            ("serviceKey", settings.public_data_service_key.as_str()),
            ("pageNo", &page_no.to_string()),
            ("returnType", "json"),
        ])
        .query(&[("numOfRows", page_size.to_string())]);

    if let Some(region_code) = region_code(region) {
        request = request.query(&[("cond[OPN_ATMY_GRP_CD::EQ]", region_code)]);
    }

    if let Some(from_date) = compact_date(&filters.from_date) {
        request = request.query(&[("cond[LCPMT_YMD::GTE]", from_date)]);
    }

    if let Some(to_date) = compact_date(&filters.to_date).and_then(|date| next_date(&date)) {
        request = request.query(&[("cond[LCPMT_YMD::LT]", to_date)]);
    }

    if filters.status == "active" {
        request = request.query(&[("cond[SALS_STTS_CD::EQ]", "01")]);
    }

    if !filters.keyword.trim().is_empty() {
        request = request.query(&[("cond[BPLC_NM::LIKE]", filters.keyword.as_str())]);
    }

    let payload: Value = request
        .send()
        .await
        .map_err(|error| format!("공공데이터 API 호출 실패: {error}"))?
        .json()
        .await
        .map_err(|error| format!("공공데이터 응답 파싱 실패: {error}"))?;

    let result_code = payload
        .pointer("/response/header/resultCode")
        .and_then(Value::as_str)
        .unwrap_or("0");
    if result_code != "0" {
        let message = payload
            .pointer("/response/header/resultMsg")
            .and_then(Value::as_str)
            .unwrap_or("공공데이터 API 오류가 발생했습니다.");
        return Err(message.to_string());
    }

    let items = payload
        .pointer("/response/body/items/item")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let total_count = read_total_count(&payload);

    let businesses: Vec<Business> = items
        .iter()
        .map(|item| normalize_business(item, endpoint))
        .filter(|business| matches_region(business, region))
        .collect();

    Ok(BusinessPage {
        businesses,
        total_count,
    })
}

fn find_endpoint(key: &str) -> Result<EndpointSpec, String> {
    ENDPOINTS
        .iter()
        .find(|endpoint| endpoint.key == key)
        .copied()
        .ok_or_else(|| "지원하지 않는 businessType입니다.".to_string())
}

fn target_endpoints(filters: &SearchFilters) -> Result<Vec<EndpointSpec>, String> {
    if filters.business_type != "all" {
        return Ok(vec![find_endpoint(&filters.business_type)?]);
    }

    if filters.enabled_business_types.is_empty() {
        return Ok(ENDPOINTS.to_vec());
    }

    let mut endpoints = Vec::new();
    for business_type in &filters.enabled_business_types {
        endpoints.push(find_endpoint(business_type)?);
    }

    Ok(endpoints)
}

fn target_regions(filters: &SearchFilters) -> Vec<String> {
    let source = if filters.regions.is_empty() {
        vec![filters.region.clone()]
    } else {
        filters.regions.clone()
    };

    let mut seen = HashSet::new();
    source
        .into_iter()
        .map(|region| region.trim().to_string())
        .filter(|region| !region.is_empty())
        .filter(|region| seen.insert(region.clone()))
        .collect()
}

fn permission_status_from_payload(endpoint: EndpointSpec, payload: &Value) -> ApiPermissionStatus {
    let result_code = payload
        .pointer("/response/header/resultCode")
        .and_then(read_value_as_string)
        .unwrap_or_else(|| "0".to_string());
    let message = payload
        .pointer("/response/header/resultMsg")
        .and_then(Value::as_str)
        .unwrap_or("사용 가능");

    if is_success_result_code(&result_code) || message.eq_ignore_ascii_case("NORMAL_SERVICE") {
        return permission_status(endpoint, "available", "사용 가능".to_string());
    }

    permission_status(endpoint, classify_permission_error(message), message.to_string())
}

fn permission_status(endpoint: EndpointSpec, status: &str, message: String) -> ApiPermissionStatus {
    ApiPermissionStatus {
        business_type: endpoint.key.to_string(),
        label: endpoint.label.to_string(),
        status: status.to_string(),
        service_name: endpoint.service_name.to_string(),
        apply_url: endpoint.apply_url.to_string(),
        message,
    }
}

fn read_value_as_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(ToString::to_string)
        .or_else(|| value.as_i64().map(|number| number.to_string()))
        .or_else(|| value.as_u64().map(|number| number.to_string()))
}

fn is_success_result_code(result_code: &str) -> bool {
    let trimmed = result_code.trim();
    trimmed == "0" || trimmed == "00"
}

fn classify_permission_error(message: &str) -> &'static str {
    let normalized = message.to_lowercase();
    if normalized.contains("service_key")
        || normalized.contains("인증키")
        || normalized.contains("등록되지 않은")
        || normalized.contains("invalid")
    {
        return "invalidKey";
    }

    if normalized.contains("access")
        || normalized.contains("denied")
        || normalized.contains("권한")
        || normalized.contains("승인")
        || normalized.contains("활용신청")
    {
        return "unauthorized";
    }

    "unknown"
}

fn total_pages(total_count: usize, page_size: usize) -> u16 {
    if total_count == 0 {
        return 1;
    }

    total_count.div_ceil(page_size).min(u16::MAX as usize) as u16
}

fn read_total_count(payload: &Value) -> usize {
    let value = payload.pointer("/response/body/totalCount");
    if let Some(count) = value.and_then(Value::as_u64) {
        return count as usize;
    }

    value
        .and_then(Value::as_str)
        .and_then(|count| count.parse::<usize>().ok())
        .unwrap_or(0)
}

async fn enrich_businesses_with_kakao(client: &reqwest::Client, kakao_key: &str, businesses: &mut [Business]) {
    if kakao_key.trim().is_empty() {
        return;
    }

    for business in businesses.iter_mut() {
        if !needs_kakao_enrichment(business) {
            continue;
        }

        if let Ok(Some(place)) = search_kakao_place(client, kakao_key, business).await {
            apply_kakao_place(business, &place);
        }
    }
}

async fn search_kakao_place(
    client: &reqwest::Client,
    kakao_key: &str,
    business: &Business,
) -> Result<Option<Value>, reqwest::Error> {
    let query = kakao_query(business);
    if query.trim().is_empty() {
        return Ok(None);
    }

    let payload: Value = client
        .get("https://dapi.kakao.com/v2/local/search/keyword.json")
        .header("Authorization", format!("KakaoAK {kakao_key}"))
        .query(&[("query", query), ("size", "1".to_string())])
        .send()
        .await?
        .json()
        .await?;

    Ok(payload
        .get("documents")
        .and_then(Value::as_array)
        .and_then(|documents| documents.first())
        .cloned())
}

#[tauri::command]
fn save_csv(csv: String) -> Result<String, String> {
    let mut path = downloads_dir().ok_or_else(|| "다운로드 폴더를 찾지 못했습니다.".to_string())?;
    path.push(format!("localbiz-scout-{}.csv", today_utc()));

    let content = format!("\u{feff}{csv}");
    std::fs::write(&path, content).map_err(|error| format!("CSV 파일 저장 실패: {error}"))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_file_location(path: String) -> Result<(), String> {
    let file_path = PathBuf::from(path);
    if !file_path.exists() {
        return Err("CSV 파일을 찾지 못했습니다.".to_string());
    }

    open_path_in_file_manager(&file_path)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("허용되지 않은 외부 URL입니다.".to_string());
    }

    open_url_in_browser(&url)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            search_businesses,
            export_businesses,
            check_api_permissions,
            save_csv,
            open_file_location,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running LocalBiz Scout");
}

fn normalize_business(item: &Value, endpoint: EndpointSpec) -> Business {
    let business_type = read(item, "BZSTAT_SE_NM").unwrap_or_else(|| endpoint.label.to_string());

    Business {
        id: read(item, "MNG_NO").unwrap_or_else(|| {
            format!(
                "{}-{}",
                read(item, "BPLC_NM").unwrap_or_default(),
                read(item, "LCPMT_YMD").unwrap_or_default()
            )
        }),
        business_name: read(item, "BPLC_NM").unwrap_or_default(),
        business_type,
        category: read(item, "NTSL_MTH_NM")
            .or_else(|| read(item, "DTL_SALS_STTS_NM"))
            .unwrap_or_default(),
        road_address: read(item, "ROAD_NM_ADDR").unwrap_or_default(),
        jibun_address: read(item, "LOTNO_ADDR").unwrap_or_default(),
        phone: read(item, "TELNO").unwrap_or_default(),
        license_date: normalize_date(&read(item, "LCPMT_YMD").unwrap_or_default()),
        last_modified_date: normalize_date(
            &read(item, "LAST_MDFCN_PNT")
                .or_else(|| read(item, "DAT_UPDT_PNT"))
                .unwrap_or_default(),
        ),
        status: normalize_status(
            &read(item, "SALS_STTS_NM")
                .or_else(|| read(item, "DTL_SALS_STTS_NM"))
                .unwrap_or_default(),
        ),
        source: format!("PUBLIC_DATA:{}", endpoint.key),
        place_url: String::new(),
        address_enriched: false,
        phone_enriched: false,
    }
}

fn needs_kakao_enrichment(business: &Business) -> bool {
    is_masked(&business.road_address) || is_masked(&business.jibun_address) || business.phone.trim().is_empty()
}

fn is_masked(value: &str) -> bool {
    value.contains('*')
}

fn kakao_query(business: &Business) -> String {
    let clean_road = unmaskable_prefix(&business.road_address);
    let clean_jibun = unmaskable_prefix(&business.jibun_address);
    let address = if clean_road.len() >= clean_jibun.len() {
        clean_road
    } else {
        clean_jibun
    };

    [business.business_name.as_str(), address.as_str()]
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn unmaskable_prefix(value: &str) -> String {
    let prefix = value.split('*').next().unwrap_or(value).trim();
    prefix
        .trim_end_matches(',')
        .trim_end_matches('-')
        .trim()
        .to_string()
}

fn apply_kakao_place(business: &mut Business, place: &Value) {
    let road_address = read(place, "road_address_name").unwrap_or_default();
    let jibun_address = read(place, "address_name").unwrap_or_default();
    let phone = read(place, "phone").unwrap_or_default();
    let place_url = read(place, "place_url").unwrap_or_default();

    if should_replace_address(&business.road_address, &road_address) {
        business.road_address = road_address;
        business.address_enriched = true;
    }

    if should_replace_address(&business.jibun_address, &jibun_address) {
        business.jibun_address = jibun_address;
        business.address_enriched = true;
    }

    if business.phone.trim().is_empty() && !phone.is_empty() {
        business.phone = phone;
        business.phone_enriched = true;
    }

    if business.place_url.trim().is_empty() && !place_url.is_empty() {
        business.place_url = place_url;
    }

    if business.address_enriched || business.phone_enriched || !business.place_url.is_empty() {
        business.source = format!("{}+KAKAO", business.source);
    }
}

fn should_replace_address(current: &str, candidate: &str) -> bool {
    if candidate.trim().is_empty() {
        return false;
    }

    current.trim().is_empty() || is_masked(current)
}

fn read(item: &Value, key: &str) -> Option<String> {
    item.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_date(value: &str) -> String {
    let compact: String = value.chars().filter(char::is_ascii_digit).collect();
    if compact.len() >= 8 {
        format!("{}-{}-{}", &compact[0..4], &compact[4..6], &compact[6..8])
    } else {
        String::new()
    }
}

fn normalize_status(value: &str) -> String {
    if value.contains("폐업") {
        "closed".to_string()
    } else {
        "active".to_string()
    }
}

fn region_code(region: &str) -> Option<&'static str> {
    match region {
        "수원" | "수원시" => Some("3740000"),
        "성남" | "성남시" | "분당" | "분당구" => Some("3780000"),
        "의정부" | "의정부시" => Some("3820000"),
        "안양" | "안양시" => Some("3830000"),
        "부천" | "부천시" => Some("3860000"),
        "광명" | "광명시" => Some("3900000"),
        "평택" | "평택시" => Some("3910000"),
        "동두천" | "동두천시" => Some("3920000"),
        "안산" | "안산시" => Some("3930000"),
        "고양" | "고양시" | "일산" | "일산동구" | "일산서구" => Some("3940000"),
        "과천" | "과천시" => Some("3970000"),
        "구리" | "구리시" => Some("3980000"),
        "남양주" | "남양주시" => Some("3990000"),
        "오산" | "오산시" => Some("4000000"),
        "시흥" | "시흥시" => Some("4010000"),
        "군포" | "군포시" | "산본" | "산본동" => Some("4020000"),
        "의왕" | "의왕시" => Some("4030000"),
        "하남" | "하남시" => Some("4040000"),
        "용인" | "용인시" => Some("4050000"),
        "파주" | "파주시" => Some("4060000"),
        "이천" | "이천시" => Some("4070000"),
        "안성" | "안성시" => Some("4080000"),
        "김포" | "김포시" => Some("4090000"),
        "화성" | "화성시" => Some("5530000"),
        "광주" | "광주시" => Some("5540000"),
        "양주" | "양주시" => Some("5590000"),
        "포천" | "포천시" => Some("5600000"),
        "여주" | "여주시" => Some("5700000"),
        "연천" | "연천군" => Some("4140000"),
        "가평" | "가평군" => Some("4160000"),
        "양평" | "양평군" => Some("4170000"),
        _ => None,
    }
}

fn region_keyword(region: &str) -> Option<&'static str> {
    match region {
        "산본" | "산본동" => Some("산본"),
        "분당" | "분당구" => Some("분당"),
        "일산" | "일산동구" | "일산서구" => Some("일산"),
        _ => None,
    }
}

fn matches_region(business: &Business, region: &str) -> bool {
    if let Some(keyword) = region_keyword(region) {
        return business.road_address.contains(keyword) || business.jibun_address.contains(keyword);
    }

    if region_code(region).is_none() && !region.trim().is_empty() {
        return business.road_address.contains(region)
            || business.jibun_address.contains(region)
            || business.business_name.contains(region);
    }

    true
}

fn dedupe_businesses(items: Vec<Business>) -> Vec<Business> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| {
            let key = if item.id.is_empty() {
                format!(
                    "{}-{}-{}-{}",
                    item.business_name, item.license_date, item.road_address, item.jibun_address
                )
            } else {
                item.id.clone()
            };

            seen.insert(key)
        })
        .collect()
}

fn compact_date(value: &str) -> Option<String> {
    let compact: String = value.chars().filter(char::is_ascii_digit).collect();
    if compact.len() == 8 {
        Some(compact)
    } else {
        None
    }
}

fn next_date(value: &str) -> Option<String> {
    let year: i32 = value.get(0..4)?.parse().ok()?;
    let month: u32 = value.get(4..6)?.parse().ok()?;
    let day: u32 = value.get(6..8)?.parse().ok()?;
    let mut days = days_from_civil(year, month, day) + 1;
    let (next_year, next_month, next_day) = civil_from_days(&mut days);
    Some(format!("{next_year:04}{next_month:02}{next_day:02}"))
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - i32::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = month as i32;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146097 + doe - 719468) as i64
}

fn civil_from_days(days: &mut i64) -> (i32, u32, u32) {
    *days += 719468;
    let era = if *days >= 0 { *days } else { *days - 146096 } / 146097;
    let doe = *days - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let year = yoe as i32 + era as i32 * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + i32::from(month <= 2);
    (year, month as u32, day as u32)
}

fn downloads_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        return Some(PathBuf::from(home).join("Downloads"));
    }

    if let Ok(profile) = std::env::var("USERPROFILE") {
        return Some(PathBuf::from(profile).join("Downloads"));
    }

    None
}

fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|error| format!("Finder 열기 실패: {error}"))?;

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer")
        .arg(format!("/select,{}", path.to_string_lossy()))
        .status()
        .map_err(|error| format!("Explorer 열기 실패: {error}"))?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(path.parent().unwrap_or_else(|| Path::new(".")))
        .status()
        .map_err(|error| format!("파일 관리자 열기 실패: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("파일 관리자 열기 명령이 실패했습니다.".to_string())
    }
}

fn is_allowed_external_url(url: &str) -> bool {
    [
        "https://www.data.go.kr/",
        "https://data.go.kr/",
        "https://auth.data.go.kr/",
        "https://developers.kakao.com/",
        "https://accounts.kakao.com/",
    ]
    .iter()
    .any(|prefix| url.starts_with(prefix))
}

fn open_url_in_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .arg(url)
        .status()
        .map_err(|error| format!("기본 브라우저 열기 실패: {error}"))?;

    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .status()
        .map_err(|error| format!("기본 브라우저 열기 실패: {error}"))?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(url)
        .status()
        .map_err(|error| format!("기본 브라우저 열기 실패: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("기본 브라우저 열기 명령이 실패했습니다.".to_string())
    }
}

fn today_utc() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let mut days = seconds / 86_400;
    let (year, month, day) = civil_from_days(&mut days);
    format!("{year:04}-{month:02}-{day:02}")
}
