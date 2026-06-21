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

## 지원 조회

| 조건 | 설명 |
|---|---|
| `region`, `regions` | 경기도 시군 및 `산본`, `분당`, `일산` alias |
| `fromDate` | 인허가일자 시작일 |
| `toDate` | 인허가일자 종료일 |
| `businessType` | `all`, `mailOrder`, `doorToDoorSales`, `largeStore`, `generalRestaurant`, `beautySalon`, `pharmacy`, `clinic`, `lodging`, `karaokeRoom`, `martialArtsDojo`, `tobaccoRetailer` |
| `status` | `active`, `all` |
| `keyword` | 사업자명 검색 |

## 주요 기능

- 공공데이터 API 직접 조회
- 업종별 API 승인 상태 자동 진단
- 승인된 업종 기준 전체 조회
- 경기도 다중 지역 선택 조회
- 주소 마스킹 제외 필터
- 현재 페이지 CSV 저장
- 전체 결과 CSV 저장
- CSV 저장 위치 열기
- 앱 업데이트 확인 및 설치
- Kakao Local API 주소/연락처 보강 선택 지원

## 빌드

```bash
npm run tauri build
```

macOS 빌드 산출물은 기본적으로 아래에 생성됩니다.

```text
src-tauri/target/release/bundle/
```

## 업데이트 설정

Tauri updater는 서명 키가 필수입니다. private key는 커밋하지 않고 GitHub Actions Secret에 저장합니다.

```bash
npm run tauri signer generate -- -w ~/.tauri/localbiz-scout-updater.key
```

생성된 public key를 `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에 넣고, private key는 GitHub Secrets에 등록합니다.

| Secret | 설명 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | private key 파일 내용 또는 경로 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | private key 비밀번호. 비밀번호가 없으면 빈 값 |

`main` 빌드가 성공하면 `latest` 릴리즈에 updater artifact와 `latest.json`을 등록합니다.

## 다음 단계

- OS Keychain 저장
- XLSX 저장
- 정확한 total page 표시
