import { buildGradeMessages, buildMessages, gradeSchema, responseSchema, validateGrade, validateQuiz } from "./quiz.js";

const REQUEST_TIMEOUT_MS = 110_000;
const MAX_ATTEMPTS = 2;

export class QuizError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class InvalidOutputError extends Error {}

function readConfig(env) {
  const endpoint = (env.AI_ENDPOINT || "").trim().replace(/\/+$/, "");
  const apiKey = (env.AI_API_KEY || "").trim();
  const model = (env.AI_DEPLOYMENT || "").trim();
  if (!endpoint || !apiKey || !model) {
    throw new QuizError(500, "서버에 AI API 설정(AI_ENDPOINT, AI_API_KEY, AI_DEPLOYMENT)이 없습니다.");
  }
  return { endpoint, apiKey, model };
}

async function requestOnce({ messages, schema, name, validate }, config, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetchImpl(`${config.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": config.apiKey },
      body: JSON.stringify({
        model: config.model,
        messages,
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
        max_completion_tokens: 32000
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new QuizError(504, "AI 응답 시간이 초과되었습니다. 문항 수나 범위를 줄여 다시 시도해주세요.");
    }
    throw new QuizError(502, "AI 서비스에 연결하지 못했습니다.");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`AI API error ${response.status}: ${detail.slice(0, 500)}`);
    if (response.status === 401 || response.status === 403) {
      throw new QuizError(502, "AI 서비스 인증에 실패했습니다. 서버 설정을 확인해주세요.");
    }
    if (response.status === 429) throw new QuizError(429, "요청이 많습니다. 잠시 후 다시 시도해주세요.");
    throw new QuizError(502, `AI 서비스 오류가 발생했습니다. (${response.status})`);
  }

  const data = await response.json().catch(() => null);
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : undefined;
  if (!choice || !choice.message) throw new InvalidOutputError("AI 응답이 비어 있습니다.");
  if (choice.message.refusal) throw new QuizError(422, "AI가 이 요청의 처리를 거절했습니다.");
  if (choice.finish_reason === "length") {
    throw new QuizError(502, "AI 응답이 너무 길어 중간에 끊겼습니다. 문항 수를 줄여 다시 시도해주세요.");
  }

  let parsed;
  try {
    parsed = JSON.parse(choice.message.content);
  } catch {
    throw new InvalidOutputError("AI 응답을 JSON으로 읽을 수 없습니다.");
  }

  try {
    return validate(parsed);
  } catch (error) {
    throw new InvalidOutputError(error.message);
  }
}

async function callModel(request, env, fetchImpl) {
  const config = readConfig(env);
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await requestOnce(request, config, fetchImpl);
    } catch (error) {
      if (!(error instanceof InvalidOutputError)) throw error;
      console.warn(`Invalid AI output for ${request.name} (attempt ${attempt}): ${error.message}`);
      lastError = error;
    }
  }
  throw new QuizError(502, `AI가 올바른 형식으로 응답하지 못했습니다. 다시 시도해주세요. (${lastError.message})`);
}

export function generateQuiz(input, env = process.env, fetchImpl = fetch) {
  return callModel({
    name: "quiz",
    messages: buildMessages(input),
    schema: responseSchema(input.type),
    validate: (data) => validateQuiz(data, input.type, input.count)
  }, env, fetchImpl);
}

export function gradeAnswers(items, env = process.env, fetchImpl = fetch) {
  return callModel({
    name: "grading",
    messages: buildGradeMessages(items),
    schema: gradeSchema,
    validate: (data) => validateGrade(data, items.length)
  }, env, fetchImpl);
}
