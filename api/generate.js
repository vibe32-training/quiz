import { generateQuiz, QuizError } from "../lib/generate.js";
import { validateRequest } from "../lib/quiz.js";

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "POST 요청만 지원합니다." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return send(res, 400, { error: "요청 본문이 올바른 JSON이 아닙니다." });
  }

  const { value, error } = validateRequest(body);
  if (error) return send(res, 400, { error });

  try {
    const questions = await generateQuiz(value);
    return send(res, 200, { ...value, questions });
  } catch (err) {
    if (err instanceof QuizError) return send(res, err.status, { error: err.message });
    console.error("Unexpected error:", err && err.message);
    return send(res, 500, { error: "서버 오류가 발생했습니다." });
  }
}
