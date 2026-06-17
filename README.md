# 상권스카우트

지역 사업자 인허가 데이터를 조회하고 CSV로 저장하는 데스크톱 클라이언트입니다.

## 실행

```bash
npm install
npm run tauri dev
```

프론트엔드만 실행:

```bash
npm run dev
```

## 첫 실행 설정

앱 첫 실행 시 아래 값을 입력합니다.

| 값 | 설명 |
|---|---|
| `PUBLIC_DATA_SERVICE_KEY` | 필수. 공공데이터포털 인증키 |
| `KAKAO_REST_API_KEY` | 선택. 주소/연락처 보강용 Kakao REST API Key |

`KAKAO_REST_API_KEY`를 비워두면 Kakao Local API 호출 없이 공공데이터 결과만 표시합니다.

현재 MVP는 설정값을 브라우저/Tauri WebView의 localStorage에 저장합니다. 배포 전에는 OS Keychain 저장으로 교체하는 것을 권장합니다.

## 지원 조회

| 조건 | 설명 |
|---|---|
| `region` | `군포`, `군포시`, `산본` |
| `fromDate` | 인허가일자 시작일 |
| `toDate` | 인허가일자 종료일 |
| `businessType` | `all`, `mailOrder`, `doorToDoorSales`, `largeStore`, `generalRestaurant`, `beautySalon`, `pharmacy`, `clinic`, `lodging`, `karaokeRoom`, `martialArtsDojo`, `tobaccoRetailer` |
| `status` | `active`, `all` |
| `keyword` | 사업자명 검색 |

## 주요 기능

- 공공데이터 API 직접 조회
- 업종별 API 승인 상태 자동 진단
- 승인된 업종 기준 전체 조회
- 군포/산본 지역 코드 `4020000` 적용
- 주소 마스킹 제외 필터
- 현재 페이지 CSV 저장
- 전체 결과 CSV 저장
- CSV 저장 위치 열기
- Kakao Local API 주소/연락처 보강 선택 지원

## 빌드

```bash
npm run tauri build
```

macOS 빌드 산출물은 기본적으로 아래에 생성됩니다.

```text
src-tauri/target/release/bundle/
```

## 다음 단계

- OS Keychain 저장
- XLSX 저장
- 정확한 total page 표시
