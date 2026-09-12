// 릴스/포토툰/카드뉴스/AI 일러스트 만화는 전부 puppeteer(브라우저)나 ffmpeg(영상 인코딩)를 쓰는
// 무거운 작업이다. Render 무료 플랜(RAM 512MB, 약한 CPU)에서 이런 요청이 동시에 여러 개 들어오면
// 서로 자원을 다퉈서 전부 502로 죽는 걸 실제로 확인했다 — 사장님이 버튼 여러 개를 연달아 눌러도
// 한 번에 하나씩만 처리되게 줄을 세워서, 느리더라도 하나씩은 확실히 끝나게 한다.
let queue = Promise.resolve();

function runExclusive(fn) {
  const result = queue.then(() => fn());
  // 이번 작업이 실패해도 줄이 끊기지 않고 다음 작업이 이어지도록, 대기용 체인은 항상 성공 처리한다.
  queue = result.then(() => {}, () => {});
  return result;
}

// 라우트 핸들러를 그대로 감싸서, 그 핸들러가 끝날 때까지 다음 요청은 대기하게 만드는 미들웨어.
function serialize(handler) {
  return (req, res, next) => {
    runExclusive(() => handler(req, res, next)).catch(next);
  };
}

// multer 같은 업로드 미들웨어까지 통째로 줄 세운다 — 업로드(디스크 쓰기)만 먼저 동시에 처리되고
// 뒤의 핸들러만 나중에 큐를 타면, 여러 요청의 파일 업로드 자체가 겹치면서 메모리를 밀어올려
// 프로세스가 죽는 걸 막지 못한다. 업로드 시작 시점부터 이미 순서를 기다리게 한다.
function serializeUpload(uploadMiddleware, handler) {
  return (req, res, next) => {
    runExclusive(() => new Promise((resolve) => {
      uploadMiddleware(req, res, (err) => {
        if (err) {
          next(err);
          return resolve();
        }
        Promise.resolve(handler(req, res, next))
          .catch((e) => next(e))
          .then(resolve);
      });
    })).catch(next);
  };
}

module.exports = { runExclusive, serialize, serializeUpload };
