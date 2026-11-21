# 개발 현황 (STATUS)

> 이 문서에는 API 키 등 비밀값을 기록하지 않는다.

**최종 갱신:** 2026-11-21
**현재 단계:** 3단계 로컬 검증 완료 → 4단계 GitHub 업로드 준비

## 프로젝트 구조

| 경로 | 역할 |
|---|---|
| `public/index.html` | 퀴즈 생성 화면 (과목·단원 입력, 객관식/주관식, 문항 수 1~25) |
| `api/generate.js` | `POST /api/generate` 서버 API (Vercel 함수와 로컬 서버가 공용 사용) |
| `lib/quiz.js` | 요청 검증, 시스템 프롬프트, 응답 스키마, 결과 검증 |
| `lib/generate.js` | AI API 호출(Azure OpenAI 호환 v1 `chat/completions`), 오류 처리, 형식 오류 시 1회 재시도 |
| `server.js` | 로컬 개발 서버. `env_local.txt` 또는 `.env.local`에서 설정을 읽고 `public/`만 제공 |
| `test/quiz.test.js` | 입력·응답 검증 및 API 호출 로직 단위 테스트 |
| `vercel.json` | API 함수 최대 실행 시간 120초 설정 |
| `.gitignore`, `.vercelignore` | `env_local.txt`, `.env*` 업로드 차단 |

외부 npm 패키지 의존성 없음 (Node.js 20 이상 내장 기능만 사용).

## 필요한 환경 변수

| 이름 | 설명 |
|---|---|
| `AI_ENDPOINT` | AI 서비스 엔드포인트 (`.../openai/v1`) |
| `AI_API_KEY` | AI 서비스 키 — 서버에서만 사용, 브라우저 응답에 포함되지 않음 |
| `AI_DEPLOYMENT` | 배포(모델) 이름 |

로컬에서는 `env_local.txt`에서 읽고, Vercel에서는 프로젝트 환경 변수로 등록한다.

## 완료된 작업

- [x] PRD, 개발 계획 문서 작성
- [x] 퀴즈 전용 화면 구현 (기존 범용 초안 `index.html` 삭제)
  - 입력 검증, 문항 수 빠른 선택(5/10/20/25), 로딩 표시
  - 정답·해설 접기/펼치기, 정답 모두 보기, 텍스트 복사, JSON 저장, 인쇄
- [x] 서버 API 구현: 입력 재검증, 구조화 출력(JSON Schema) 요청, 응답 개수·형식 검증
- [x] 프롬프트 갱신: 유형·문항 수 반영, 사용자 입력을 지시문이 아닌 데이터로 취급
- [x] 로컬 개발 서버 구현 (`public/` 밖의 파일 접근 차단)

## 검증 결과 (로컬)

| 항목 | 결과 |
|---|---|
| 단위 테스트 6건 (`node --test`) | 통과 |
| 문항 수 0·26 / 공백 과목 / 잘못된 JSON 요청 → 400 | 통과 |
| `/env_local.txt`, `/../env_local.txt`, `/server.js` 접근 → 404 | 통과 |
| 객관식 3문항 실제 생성 | 통과 (약 4초) |
| 주관식 3문항 실제 생성 | 통과 (약 8초) |
| 객관식 25문항(최대) 실제 생성 | 통과 (약 32초) |
| 브라우저: 필수 입력 누락·문항 수 30 입력 오류 표시 | 통과 |
| 브라우저: 객관식 5문항 생성, 정답 모두 보기 | 통과 |
| API 키가 `env_local.txt` 외 프로젝트 파일에 없음 | 통과 |

## 다음 작업

1. Git 저장소 초기화 후 `git status`로 `env_local.txt`가 추적되지 않는지 확인
2. GitHub에 푸시
3. Vercel에서 저장소 연결 (Framework Preset: Other, 빌드 명령 없음)
4. Vercel 환경 변수에 `AI_ENDPOINT`, `AI_API_KEY`, `AI_DEPLOYMENT` 등록
5. Preview 배포에서 객관식·주관식·25문항 생성 확인 후 Production 배포

## 이슈 및 결정 사항

- **외부 패키지 미사용:** 이 PC에서 PowerShell 실행 정책으로 `npm`이 막혀 있고, 기능상 필요하지 않아 의존성 없이 구현했다. (`npm` 대신 `node` 명령으로 직접 실행)
- **응답 형식:** 구조화 출력의 최상위는 객체여야 해서 API 응답을 `{ ..., questions: [...] }`로 감쌌다. PRD 6장에 반영.
- **재시도:** 모델이 문항 수나 형식을 어기면 1회 재시도하고, 그래도 실패하면 오류로 안내한다.
- **시간 제한:** 서버 AI 호출 110초, Vercel 함수 120초, 브라우저 130초. 25문항이 약 32초 걸려 여유가 있다.

## 로컬 실행 방법

```powershell
node server.js     # http://localhost:3000
node --test        # 단위 테스트
```
