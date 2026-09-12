const puppeteer = require('puppeteer');

// 포토툰/AI 일러스트 만화/카드뉴스가 요청마다 puppeteer.launch()로 브라우저를 새로 띄우면
// Render 무료 플랜(RAM 512MB)에서 느리고 메모리를 계속 밀어올린다 — 브라우저 인스턴스 하나를
// 프로세스 전체에서 재사용하고, 요청마다 새 탭(page)만 열었다 닫는다.
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}

module.exports = { getBrowser, closeBrowser };
