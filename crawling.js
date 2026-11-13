
(async () => {
  // ===== 수집 설정 =====
  const START_YEAR = 2024;
  const END_YEAR = 2026;
  const SEMESTERS = ["1", "2"];
  const DELAY_MS = 3000;
  const TIMEOUT_MS = 15000;
  const MAX_REQUESTS = 500;

  if (window.GradeFlowCollector?.running) {
    console.warn("이미 수집 중입니다.");
    return;
  }

  const yearInput = document.getElementById("edt_Shyr");
  const semesterSelect = document.getElementById("cbo_Smst");
  const departmentSelect = document.getElementById("cbo_Less");
  const searchButton = document.getElementById("btn_ReportSearch");

  if (!yearInput || !semesterSelect ||
      !departmentSelect || !searchButton) {
    console.error("필요한 화면 요소를 찾지 못했습니다.");
    return;
  }

  const targets = [];

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    for (const semester of SEMESTERS) {
      targets.push({ year, semester });
    }
  }

  if (!confirm(
    `${START_YEAR}~${END_YEAR}학년도, ` +
    `학기 ${SEMESTERS.join(", ")}를 수집합니다.\n` +
    "학과별로 최소 3초 간격을 두고 조회합니다.\n" +
    "계속하시겠습니까?"
  )) return;

  const state = window.GradeFlowCollector = {
    running: true,
    stop: false,
    requests: 0,
    completed: 0,
    rows: [],
    failures: []
  };

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  let pending = null;
  const seen = new Set();

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalFetch = window.fetch;

  // ===== 요청 본문 분석 =====
  function parseBody(body) {
    try {
      if (typeof body !== "string") return null;

      const text = body.trim();

      if (text.startsWith("{")) {
        return JSON.parse(text);
      }

      return Object.fromEntries(
        new URLSearchParams(text)
      );
    } catch {
      return null;
    }
  }

  // ===== 강의 응답 처리 =====
  function receiveResponse(text, body) {
    if (!pending) return;

    const payload = parseBody(body);
    if (!payload) return;

    if (payload.fsp_cmd !== "getScheduleGridData") {
      return;
    }

    if (String(payload.LESS_CD) !== pending.department) {
      return;
    }

    if (String(payload.SP_YMST) !== pending.yearSemester) {
      return;
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return;
    }

    if (!Array.isArray(data.rows)) {
      return;
    }

    const current = pending;
    pending = null;
    clearTimeout(current.timer);

    if (String(data.ErrorCode) !== "0") {
      current.reject(
        new Error(data.ErrorMsg || "서버 오류")
      );
      return;
    }

    const valid = data.rows.every(row =>
      String(row.SP_YMST) === current.yearSemester &&
      String(row.LESS_CD) === current.department
    );

    if (!valid) {
      current.reject(
        new Error("요청한 학기·학과와 응답이 다릅니다.")
      );
      return;
    }

    current.resolve(data.rows);
  }

  // ===== XMLHttpRequest 감시 =====
  XMLHttpRequest.prototype.open = function(
    method, url, ...rest
  ) {
    this.__gfUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (/JSONMain/i.test(this.__gfUrl || "")) {
      this.addEventListener("loadend", () => {
        try {
          receiveResponse(this.responseText, body);
        } catch (error) {
          console.warn("응답 처리 실패:", error);
        }
      }, { once: true });
    }

    return originalSend.call(this, body);
  };

  // ===== fetch 감시 =====
  window.fetch = async function(input, init) {
    let request;
    let requestBody = "";

    try {
      request = new Request(input, init);
      requestBody = await request.clone().text();
    } catch {}

    const response = await originalFetch.apply(this, arguments);

    if (request && /JSONMain/i.test(request.url)) {
      response.clone().text()
        .then(text => receiveResponse(text, requestBody))
        .catch(() => {});
    }

    return response;
  };

  // ===== 입력값 변경 =====
  function changeValue(element, value) {
    element.value = String(value);

    element.dispatchEvent(
      new Event("input", { bubbles: true })
    );

    element.dispatchEvent(
      new Event("change", { bubbles: true })
    );
  }

  // ===== 학과 목록 읽기 =====
  function getDepartments() {
    return [...departmentSelect.options]
      .filter(option =>
        option.value &&
        !option.disabled &&
        option.value !== "0" &&
        !/전체/.test(option.textContent)
      )
      .map(option => ({
        code: option.value,
        name: option.textContent.trim()
      }));
  }

  // ===== 강의 한 번 조회 =====
  function queryCourses(yearSemester, departmentCode) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending?.timer === timer) {
          pending = null;
        }
        reject(new Error("응답 시간 초과"));
      }, TIMEOUT_MS);

      pending = {
        yearSemester,
        department: departmentCode,
        resolve,
        reject,
        timer
      };

      try {
        searchButton.click();
      } catch (error) {
        clearTimeout(timer);
        pending = null;
        reject(error);
      }
    });
  }

  // ===== 파일 다운로드 =====
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  // ===== 수집 시작 =====
  try {
    for (const target of targets) {
      if (state.stop) break;

      const { year, semester } = target;
      const yearSemester = `${year}${semester}`;

      console.log(`===== ${yearSemester} 수집 시작 =====`);

      changeValue(yearInput, year);
      yearInput.dispatchEvent(
        new Event("blur")
      );

      await sleep(700);

      changeValue(semesterSelect, semester);

      await sleep(700);

      // 학기 변경 후 학과 목록 다시 읽기
      const departments = getDepartments();

      console.log(
        `${yearSemester}: 학과 ${departments.length}개`
      );

      if (departments.length === 0) {
        state.failures.push({
          yearSemester,
          error: "학과 목록 없음"
        });
        continue;
      }

      for (const dept of departments) {
        if (state.stop) break;

        if (state.requests >= MAX_REQUESTS) {
          console.warn("최대 요청 수에 도달했습니다.");
          state.stop = true;
          break;
        }

        changeValue(departmentSelect, dept.code);

        await sleep(400);

        state.requests++;

        try {
          const rows = await queryCourses(
            yearSemester,
            dept.code
          );

          for (const row of rows) {
            const key = [
              row.SP_YMST,
              row.LESS_CD,
              row.SUBJ_CD,
              row.LECT_NUMB,
              row.DN_DIV
            ].join("|");

            if (!seen.has(key)) {
              seen.add(key);
              state.rows.push(row);
            }
          }

          console.log(
            `[${state.requests}] ${yearSemester} / ` +
            `${dept.name}: ${rows.length}개, ` +
            `누적 ${state.rows.length}개`
          );

        } catch (error) {
          state.failures.push({
            yearSemester,
            department: dept.name,
            code: dept.code,
            error: error.message
          });

          console.warn(
            `${yearSemester} / ${dept.name}: ` +
            error.message
          );
        }

        state.completed++;

        await sleep(DELAY_MS);
      }
    }

  } finally {
    // 원래 네트워크 함수 복원
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
    window.fetch = originalFetch;

    if (pending) {
      clearTimeout(pending.timer);
      pending = null;
    }

    state.running = false;

    // GradeFlow용 데이터 변환
    const courses = state.rows.map(row => ({
      yearSemester: String(row.SP_YMST || ""),
      department: row.SP_LESS_CD_NM || "",
      departmentCode: String(row.LESS_CD || ""),
      courseCode: String(row.SUBJ_CD || ""),
      courseName: row.SUBJ_KNM || "",
      credits: Number(row.UNIT),
      professor: row.PROF_NM || "",
      section: String(row.LECT_NUMB || ""),
      category: row.CMPT_DIV_NM || "",
      schedule: row.LSTM_LIST || ""
    }));

    const output = {
      source: "서울과학기술대학교 공개 시간표",
      collectedAt: new Date().toISOString(),
      completedRequests: state.completed,
      failures: state.failures,
      courses
    };

    // JSON 다운로드
    download(
      "seoultech_all_courses.json",
      JSON.stringify(output, null, 2),
      "application/json;charset=utf-8"
    );

    // CSV 다운로드
    const fields = [
      "yearSemester",
      "department",
      "departmentCode",
      "courseCode",
      "courseName",
      "credits",
      "professor",
      "section",
      "category",
      "schedule"
    ];

    const csv = "\uFEFF" + [
      fields.join(","),
      ...courses.map(course =>
        fields.map(field => {
          const value = String(course[field] ?? "");
          const safeValue = /^[=+\-@\t\r]/.test(value)
            ? "'" + value
            : value;

          return '"' +
            safeValue.replace(/"/g, '""') +
            '"';
        }).join(",")
      )
    ].join("\r\n");

    download(
      "seoultech_all_courses.csv",
      csv,
      "text/csv;charset=utf-8"
    );

    console.log("===== 수집 결과 =====", {
      requests: state.requests,
      courses: courses.length,
      failures: state.failures.length
    });

    console.log("실패 목록:", state.failures);
  }
})();
