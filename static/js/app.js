(function () {
    "use strict";

    const SUBJECT_WHITELIST = [
        "数据结构",
        "计算机组成原理",
        "操作系统",
        "计算机网络",
        "数据库",
        "软件工程"
    ];

    const STORAGE_KEYS = {
        progress: "interviewTrainerProgress",
        session: "interviewTrainerSession"
    };

    const MASTERY_MAP = {
        weak: {
            label: "不会",
            hint: "需要重答和补概念"
        },
        fuzzy: {
            label: "模糊",
            hint: "能答框架，但细节不稳"
        },
        solid: {
            label: "会",
            hint: "能完整回答并展开"
        }
    };

    const TRAINING_MODES = {
        survey: {
            label: "首轮遍历优先"
        },
        reinforce: {
            label: "弱项强化"
        }
    };

    const ALLOWED_STATUSES = new Set(["draft", "verified", "invalid"]);
    const RECENT_WINDOW_SIZE = 10;
    const IMPORT_SUBJECT_PREFIX = {
        "数据结构": "ds",
        "计算机组成原理": "co",
        "操作系统": "os",
        "计算机网络": "net",
        "数据库": "db",
        "软件工程": "se"
    };

    const state = {
        bank: [],
        sourceLabel: "data/question-bank.json",
        diagnostics: {
            invalidCount: 0,
            skippedCount: 0,
            errors: []
        },
        progress: loadProgress(),
        session: loadSession(),
        selectedSubject: "all",
        currentQuestion: null
    };

    const elements = {};

    document.addEventListener("DOMContentLoaded", initialize);

    function initialize() {
        cacheElements();
        bindEvents();
        state.selectedSubject = normalizeSelectedSubject(state.session.selectedSubject);
        renderSubjectButtons();
        updateBanner();
        updateStats();
        renderTrainerState();
        loadDefaultQuestionBank();
    }

    function cacheElements() {
        elements.heroVerifiedCount = document.getElementById("heroVerifiedCount");
        elements.heroSourceLabel = document.getElementById("heroSourceLabel");
        elements.subjectButtons = document.getElementById("subjectButtons");
        elements.trainingModeButtons = document.getElementById("trainingModeButtons");
        elements.dataBanner = document.getElementById("dataBanner");
        elements.totalVerifiedCount = document.getElementById("totalVerifiedCount");
        elements.filteredCount = document.getElementById("filteredCount");
        elements.sessionCount = document.getElementById("sessionCount");
        elements.focusCount = document.getElementById("focusCount");
        elements.unseenCount = document.getElementById("unseenCount");
        elements.trainerSubtitle = document.getElementById("trainerSubtitle");
        elements.questionShell = document.getElementById("questionShell");
        elements.nextQuestionBtn = document.getElementById("nextQuestionBtn");
        elements.resetProgressBtn = document.getElementById("resetProgressBtn");
        elements.loadManualBankBtn = document.getElementById("loadManualBankBtn");
        elements.loadMarkdownFolderBtn = document.getElementById("loadMarkdownFolderBtn");
        elements.manualBankInput = document.getElementById("manualBankInput");
        elements.manualMarkdownDirInput = document.getElementById("manualMarkdownDirInput");
    }

    function bindEvents() {
        elements.subjectButtons.addEventListener("click", onSubjectClick);
        elements.trainingModeButtons.addEventListener("click", onTrainingModeClick);
        elements.nextQuestionBtn.addEventListener("click", function () {
            drawNextQuestion();
        });
        elements.questionShell.addEventListener("click", onQuestionShellClick);
        elements.resetProgressBtn.addEventListener("click", resetProgress);
        elements.loadManualBankBtn.addEventListener("click", function () {
            elements.manualBankInput.click();
        });
        elements.loadMarkdownFolderBtn.addEventListener("click", function () {
            elements.manualMarkdownDirInput.click();
        });
        elements.manualBankInput.addEventListener("change", onManualBankSelected);
        elements.manualMarkdownDirInput.addEventListener("change", onManualMarkdownFolderSelected);
    }

    async function loadDefaultQuestionBank() {
        try {
            const response = await fetch("data/question-bank.json", { cache: "no-store" });
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }

            const payload = await response.json();
            applyQuestionBank(payload, "data/question-bank.json");
        } catch (error) {
            state.bank = [];
            state.sourceLabel = "data/question-bank.json 未加载";
            state.diagnostics = {
                invalidCount: 0,
                skippedCount: 0,
                errors: [
                    "默认题库加载失败。若你是直接用 file:// 打开页面，请改用本地静态服务，或点击“加载 JSON 题库”或“导入 Markdown 文件夹”。"
                ]
            };
            state.currentQuestion = null;
            state.session.currentQuestionId = null;
            state.session.answerVisible = false;
            state.session.currentAssessmentRecorded = false;
            persistSession();
            renderSubjectButtons();
            updateBanner();
            updateStats();
            renderTrainerState();
            console.error(error);
        }
    }

    function onSubjectClick(event) {
        const button = event.target.closest("button[data-subject]");
        if (!button) {
            return;
        }

        state.selectedSubject = normalizeSelectedSubject(button.getAttribute("data-subject"));
        state.session.selectedSubject = state.selectedSubject;
        persistSession();
        renderSubjectButtons();
        updateStats();

        if (state.currentQuestion && questionMatchesSelection(state.currentQuestion)) {
            renderTrainerState();
            return;
        }

        restoreOrDrawQuestion();
    }

    function onTrainingModeClick(event) {
        const button = event.target.closest("button[data-mode]");
        if (!button) {
            return;
        }

        const nextMode = normalizeTrainingMode(button.getAttribute("data-mode"));
        if (state.session.trainingMode === nextMode) {
            return;
        }

        state.session.trainingMode = nextMode;
        persistSession();
        updateStats();
        renderTrainerState();
    }

    function onQuestionShellClick(event) {
        const answerButton = event.target.closest("[data-action='show-answer']");
        if (answerButton) {
            showCurrentAnswer();
            return;
        }

        const masteryButton = event.target.closest("[data-mastery]");
        if (masteryButton) {
            updateMastery(masteryButton.getAttribute("data-mastery"));
        }
    }

    function onManualBankSelected(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = function (loadEvent) {
            try {
                const payload = JSON.parse(String(loadEvent.target.result));
                applyQuestionBank(payload, file.name + "（手动加载）");
            } catch (error) {
                state.diagnostics = {
                    invalidCount: 1,
                    skippedCount: 0,
                    errors: ["手动加载失败：JSON 解析错误。请确认文件是合法的 UTF-8 JSON。"]
                };
                updateBanner();
                renderTrainerState();
                console.error(error);
            } finally {
                elements.manualBankInput.value = "";
            }
        };
        reader.readAsText(file, "utf-8");
    }

    async function onManualMarkdownFolderSelected(event) {
        const files = Array.from(event.target.files || []).filter(function (file) {
            return file && /\.md$/i.test(file.name);
        });

        if (!files.length) {
            return;
        }

        try {
            const result = await buildQuestionBankFromMarkdownFiles(files);
            applyQuestionBank(result.payload, result.sourceLabel);
        } catch (error) {
            state.diagnostics = {
                invalidCount: 1,
                skippedCount: 0,
                errors: ["Markdown 文件夹导入失败：" + (error && error.message ? error.message : String(error))]
            };
            updateBanner();
            renderTrainerState();
            console.error(error);
        } finally {
            elements.manualMarkdownDirInput.value = "";
        }
    }

    function applyQuestionBank(payload, sourceLabel) {
        const normalized = normalizeQuestionBank(payload);
        state.bank = normalized.questions;
        state.sourceLabel = sourceLabel;
        state.diagnostics = normalized.diagnostics;

        sanitizeSessionAgainstBank();

        renderSubjectButtons();
        updateBanner();
        updateStats();
        restoreOrDrawQuestion();
    }

    function normalizeQuestionBank(payload) {
        const diagnostics = {
            invalidCount: 0,
            skippedCount: 0,
            errors: []
        };

        if (!Array.isArray(payload)) {
            diagnostics.invalidCount = 1;
            diagnostics.errors.push("题库文件根节点必须是数组。");
            return { questions: [], diagnostics: diagnostics };
        }

        const questions = [];
        const idSet = new Set();
        const duplicateQuestionSet = new Set();

        payload.forEach(function (item, index) {
            const prefix = "第 " + (index + 1) + " 条记录";

            if (!item || typeof item !== "object" || Array.isArray(item)) {
                diagnostics.invalidCount += 1;
                diagnostics.errors.push(prefix + " 不是对象。");
                return;
            }

            const record = {
                id: trimString(item.id),
                subject: trimString(item.subject),
                question: trimString(item.question),
                referenceAnswer: trimString(item.referenceAnswer),
                source: {
                    document: trimString(item.source && item.source.document),
                    page: toPositiveInteger(item.source && item.source.page),
                    order: toPositiveInteger(item.source && item.source.order)
                },
                status: trimString(item.status).toLowerCase(),
                keywords: Array.isArray(item.keywords)
                    ? item.keywords.map(trimString).filter(Boolean)
                    : []
            };

            const issues = [];

            if (!record.id) {
                issues.push("缺少 id");
            }

            if (!record.subject) {
                issues.push("缺少 subject");
            } else if (!SUBJECT_WHITELIST.includes(record.subject)) {
                issues.push("subject 不在六门白名单内");
            }

            if (!record.question) {
                issues.push("缺少 question");
            }

            if (!record.referenceAnswer) {
                issues.push("缺少 referenceAnswer");
            }

            if (!record.source.document) {
                issues.push("缺少 source.document");
            }

            if (!record.source.page) {
                issues.push("source.page 必须是正整数");
            }

            if (!record.source.order) {
                issues.push("source.order 必须是正整数");
            }

            if (!record.status) {
                issues.push("缺少 status");
            } else if (!ALLOWED_STATUSES.has(record.status)) {
                issues.push("status 只能是 draft / verified / invalid");
            }

            if (record.id && idSet.has(record.id)) {
                issues.push("id 重复");
            }

            const duplicateKey = record.subject + "::" + normalizeText(record.question);
            if (record.subject && record.question && duplicateQuestionSet.has(duplicateKey)) {
                issues.push("同科目题目重复");
            }

            if (issues.length) {
                diagnostics.invalidCount += 1;
                diagnostics.errors.push(prefix + "（" + (record.id || "无 id") + "）： " + issues.join("；"));
                return;
            }

            idSet.add(record.id);
            duplicateQuestionSet.add(duplicateKey);

            if (record.status !== "verified") {
                diagnostics.skippedCount += 1;
                return;
            }

            questions.push(record);
        });

        return { questions: questions, diagnostics: diagnostics };
    }

    function sanitizeSessionAgainstBank() {
        state.selectedSubject = normalizeSelectedSubject(state.selectedSubject);
        state.session.selectedSubject = state.selectedSubject;
        state.session.trainingMode = normalizeTrainingMode(state.session.trainingMode);
        state.session.recentQuestionIds = state.session.recentQuestionIds.filter(function (id) {
            return state.bank.some(function (question) {
                return question.id === id;
            });
        });

        if (!state.bank.some(function (question) { return question.id === state.session.currentQuestionId; })) {
            state.session.currentQuestionId = null;
            state.session.answerVisible = false;
            state.session.currentAssessmentRecorded = false;
        }

        persistSession();
    }

    function restoreOrDrawQuestion() {
        if (!state.bank.length) {
            state.currentQuestion = null;
            renderTrainerState();
            updateStats();
            return;
        }

        const restored = state.bank.find(function (question) {
            return question.id === state.session.currentQuestionId && questionMatchesSelection(question);
        });

        if (restored) {
            state.currentQuestion = restored;
            renderTrainerState();
            updateStats();
            return;
        }

        drawNextQuestion();
    }

    function drawNextQuestion() {
        const candidates = getFilteredQuestions();

        if (!candidates.length) {
            state.currentQuestion = null;
            state.session.currentQuestionId = null;
            state.session.answerVisible = false;
            state.session.currentAssessmentRecorded = false;
            persistSession();
            renderTrainerState();
            updateStats();
            return;
        }

        const currentId = state.currentQuestion ? state.currentQuestion.id : null;
        const recentSet = new Set(state.session.recentQuestionIds);

        let pool = getPoolForTrainingMode(candidates.filter(function (question) {
            return !recentSet.has(question.id) && question.id !== currentId;
        }));

        if (!pool.length) {
            pool = getPoolForTrainingMode(candidates.filter(function (question) {
                return question.id !== currentId;
            }));
        }

        if (!pool.length) {
            pool = getPoolForTrainingMode(candidates.slice());
        }

        const nextQuestion = weightedPick(pool);
        if (!nextQuestion) {
            return;
        }

        markQuestionDrawn(nextQuestion.id);
        state.currentQuestion = nextQuestion;
        pushRecentQuestion(nextQuestion.id);
        state.session.currentQuestionId = nextQuestion.id;
        state.session.answerVisible = false;
        state.session.currentAssessmentRecorded = false;
        state.session.askedCount += 1;
        persistSession();

        renderTrainerState();
        updateStats();
    }

    function weightedPick(pool) {
        if (!pool.length) {
            return null;
        }

        const weightedPool = pool.map(function (question) {
            return {
                question: question,
                weight: computeQuestionWeight(question)
            };
        });

        const totalWeight = weightedPool.reduce(function (sum, item) {
            return sum + item.weight;
        }, 0);

        let cursor = Math.random() * totalWeight;
        for (let i = 0; i < weightedPool.length; i += 1) {
            cursor -= weightedPool[i].weight;
            if (cursor <= 0) {
                return weightedPool[i].question;
            }
        }

        return weightedPool[weightedPool.length - 1].question;
    }

    function getPoolForTrainingMode(pool) {
        if (state.session.trainingMode !== "survey") {
            return pool;
        }

        const unseenPool = getUnseenQuestions(pool);
        return unseenPool.length ? unseenPool : pool;
    }

    function computeQuestionWeight(question) {
        const progress = getQuestionProgress(question.id);

        if (!progress.mastery) {
            return 5;
        }

        let base = 5;
        if (progress.mastery === "weak") {
            base = 7;
        } else if (progress.mastery === "fuzzy") {
            base = 4.5;
        } else if (progress.mastery === "solid") {
            base = 1.6;
        }

        const days = daysSince(progress.lastSeenAt);
        if (days >= 30) {
            base *= 1.25;
        } else if (days >= 7) {
            base *= 1.12;
        }

        if (progress.seenCount >= 6 && progress.mastery === "solid") {
            base *= 0.85;
        }

        return Math.max(base, 1);
    }

    function showCurrentAnswer() {
        if (!state.currentQuestion) {
            return;
        }

        state.session.answerVisible = true;
        persistSession();
        renderTrainerState();
    }

    function updateMastery(mastery) {
        if (!state.currentQuestion || !MASTERY_MAP[mastery] || !state.session.answerVisible) {
            return;
        }

        const currentProgress = getQuestionProgress(state.currentQuestion.id);
        const updatedProgress = {
            mastery: mastery,
            drawCount: currentProgress.drawCount,
            seenCount: currentProgress.seenCount + (state.session.currentAssessmentRecorded ? 0 : 1),
            lastSeenAt: new Date().toISOString()
        };

        state.progress.questions[state.currentQuestion.id] = updatedProgress;
        state.session.currentAssessmentRecorded = true;
        persistProgress();
        persistSession();

        renderTrainerState();
        updateStats();
    }

    function resetProgress() {
        const confirmed = window.confirm("这会清空本地掌握度、最近题目和当前会话记录。确定继续吗？");
        if (!confirmed) {
            return;
        }

        state.progress = createDefaultProgress();
        state.session = createDefaultSession();
        state.selectedSubject = "all";
        state.currentQuestion = null;

        persistProgress();
        persistSession();

        renderSubjectButtons();
        updateStats();
        renderTrainerState();
    }

    function renderSubjectButtons() {
        const fragment = document.createDocumentFragment();
        fragment.appendChild(createSubjectButton("all", "全部六门", state.bank.length));

        SUBJECT_WHITELIST.forEach(function (subject) {
            const count = state.bank.filter(function (question) {
                return question.subject === subject;
            }).length;
            fragment.appendChild(createSubjectButton(subject, subject, count));
        });

        elements.subjectButtons.innerHTML = "";
        elements.subjectButtons.appendChild(fragment);
    }

    function renderTrainingModeButtons(unseenCount, filteredCount) {
        const fragment = document.createDocumentFragment();
        fragment.appendChild(createTrainingModeButton("survey", unseenCount, filteredCount));
        fragment.appendChild(createTrainingModeButton("reinforce", unseenCount, filteredCount));
        elements.trainingModeButtons.innerHTML = "";
        elements.trainingModeButtons.appendChild(fragment);
    }

    function createSubjectButton(subject, label, count) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "subject-btn" + (state.selectedSubject === subject ? " active" : "") + (count === 0 ? " is-empty" : "");
        button.setAttribute("data-subject", subject);
        button.setAttribute("aria-pressed", state.selectedSubject === subject ? "true" : "false");
        button.innerHTML =
            "<span class='subject-btn-label'>" + escapeHtml(label) + "</span>" +
            "<strong class='subject-btn-count'>" + count + "</strong>" +
            "<span class='subject-btn-note'>" + (subject === "all" ? "按白名单合并抽题" : "当前可用 verified 题目") + "</span>";
        return button;
    }

    function createTrainingModeButton(mode, unseenCount, filteredCount) {
        const button = document.createElement("button");
        const isActive = state.session.trainingMode === mode;
        button.type = "button";
        button.className = "training-mode-btn" + (isActive ? " active" : "");
        button.setAttribute("data-mode", mode);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");

        let note = "直接按“不会 / 模糊 / 会”的权重回抽。";
        if (mode === "survey") {
            note = filteredCount
                ? unseenCount
                    ? "当前范围还有 " + unseenCount + " 题未抽到，先完成首轮覆盖。"
                    : "当前范围首轮已完成，之后自动回到弱项强化。"
                : "当前范围为空，切换科目或导入题库后开始首轮遍历。";
        }

        button.innerHTML =
            "<span class='subject-btn-label'>" + escapeHtml(TRAINING_MODES[mode].label) + "</span>" +
            "<span class='subject-btn-note'>" + escapeHtml(note) + "</span>";
        return button;
    }

    function updateBanner() {
        const messages = [];

        messages.push("数据源： " + state.sourceLabel);

        if (state.bank.length) {
            messages.push("已加载 " + state.bank.length + " 条 verified 题目");
        } else {
            messages.push("当前没有可训练的 verified 题目");
        }

        if (state.diagnostics.skippedCount) {
            messages.push("跳过 " + state.diagnostics.skippedCount + " 条非正式记录");
        }

        if (state.diagnostics.invalidCount) {
            messages.push("拦截 " + state.diagnostics.invalidCount + " 条无效记录");
        }

        if (state.diagnostics.errors.length) {
            messages.push("问题预览： " + state.diagnostics.errors.slice(0, 2).join(" | "));
        }

        elements.dataBanner.textContent = messages.join(" · ");
        elements.dataBanner.hidden = false;
        elements.dataBanner.className = "data-banner" + (state.diagnostics.errors.length ? " warning" : "");

        elements.heroVerifiedCount.textContent = String(state.bank.length);
        elements.heroSourceLabel.textContent = state.sourceLabel;
    }

    function updateStats() {
        const filteredQuestions = getFilteredQuestions();
        const focusCount = filteredQuestions.filter(function (question) {
            const mastery = getQuestionProgress(question.id).mastery;
            return mastery === "weak" || mastery === "fuzzy";
        }).length;
        const unseenCount = getUnseenQuestions(filteredQuestions).length;

        elements.totalVerifiedCount.textContent = String(state.bank.length);
        elements.filteredCount.textContent = String(filteredQuestions.length);
        elements.sessionCount.textContent = String(state.session.askedCount);
        elements.focusCount.textContent = String(focusCount);
        elements.unseenCount.textContent = String(unseenCount);
        renderTrainingModeButtons(unseenCount, filteredQuestions.length);
        updateTrainerSubtitle(filteredQuestions.length, unseenCount);
    }

    function updateTrainerSubtitle(filteredCount, unseenCount) {
        if (!elements.trainerSubtitle) {
            return;
        }

        if (!filteredCount) {
            elements.trainerSubtitle.textContent = "当前科目没有可训练题目。切换科目或导入正式题库后即可开始。";
            return;
        }

        if (state.session.trainingMode === "survey") {
            elements.trainerSubtitle.textContent = unseenCount
                ? "当前为“首轮遍历优先”：先抽当前范围内还没抽到的 " + unseenCount + " 题，首轮完成后再按弱项权重回抽，并避开最近 10 题重复。"
                : "当前范围首轮已完成；系统会继续优先回抽“不会 / 模糊”的题，并避开最近 10 题重复。";
            return;
        }

        elements.trainerSubtitle.textContent = "当前为“弱项强化”：系统会直接按“不会 / 模糊 / 会”的权重回抽，并避开最近 10 题重复。";
    }

    function renderTrainerState() {
        if (!state.bank.length) {
            renderNoBankState();
            return;
        }

        if (!state.currentQuestion) {
            if (getFilteredQuestions().length) {
                renderReadyState();
                return;
            }

            renderNoQuestionForSelection();
            return;
        }

        renderQuestionCard(state.currentQuestion);
    }

    function renderReadyState() {
        const scopeLabel = state.selectedSubject === "all" ? "全部六门" : state.selectedSubject;
        const strategyLabel = TRAINING_MODES[state.session.trainingMode].label;

        elements.questionShell.innerHTML =
            "<article class='empty-card'>" +
            "<div>" +
            "<p class='eyebrow'>准备开始</p>" +
            "<h3 class='empty-title'>" + escapeHtml(scopeLabel) + " 已就绪</h3>" +
            "<p class='empty-copy'>当前策略：<strong>" + escapeHtml(strategyLabel) + "</strong>。点击右上角“抽取下一题”，按先答后看的节奏继续训练。</p>" +
            "</div>" +
            "<ul class='empty-list'>" +
            "<li>先答题，再展开参考答案</li>" +
            "<li>每题展开答案后用“不会 / 模糊 / 会”更新掌握度</li>" +
            "<li>首轮遍历优先会先覆盖未抽过题目，再回到弱项强化</li>" +
            "</ul>" +
            "</article>";
    }

    function renderNoBankState() {
        elements.questionShell.innerHTML =
            "<article class='empty-card'>" +
            "<div>" +
            "<p class='eyebrow'>等待正式题库</p>" +
            "<h3 class='empty-title'>当前没有可训练的 verified 题目</h3>" +
            "<p class='empty-copy'>把六门题目整理进 <code>data/question-bank.json</code>，或先点击“手动加载题库”导入一份 JSON。页面只接受六门白名单中的 verified 记录。</p>" +
            "</div>" +
            "<div class='empty-actions'>" +
            "<a class='template-link' href='data/question-bank.template.json' download>下载模板</a>" +
            "<button class='ghost-btn' type='button' id='emptyStateLoadBtn'>加载 JSON 题库</button>" +
            "<button class='ghost-btn' type='button' id='emptyStateLoadMarkdownBtn'>导入 Markdown 文件夹</button>" +
            "</div>" +
            "<ul class='empty-list'>" +
            "<li>默认题库路径：<code>data/question-bank.json</code></li>" +
            "<li>校验命令：<code>node scripts/validate-question-bank.js data/question-bank.json</code></li>" +
            "<li>也可以直接选择包含六门 <code>.md</code> 文件的本地文件夹进行导入</li>" +
            "</ul>" +
            "</article>";

        const emptyStateLoadBtn = document.getElementById("emptyStateLoadBtn");
        if (emptyStateLoadBtn) {
            emptyStateLoadBtn.addEventListener("click", function () {
                elements.manualBankInput.click();
            });
        }

        const emptyStateLoadMarkdownBtn = document.getElementById("emptyStateLoadMarkdownBtn");
        if (emptyStateLoadMarkdownBtn) {
            emptyStateLoadMarkdownBtn.addEventListener("click", function () {
                elements.manualMarkdownDirInput.click();
            });
        }
    }

    function renderNoQuestionForSelection() {
        const scopeLabel = state.selectedSubject === "all" ? "全部六门" : state.selectedSubject;

        elements.questionShell.innerHTML =
            "<article class='empty-card'>" +
            "<div>" +
            "<p class='eyebrow'>当前范围为空</p>" +
            "<h3 class='empty-title'>" + escapeHtml(scopeLabel) + " 暂无 verified 题目</h3>" +
            "<p class='empty-copy'>切换到其他科目，或把该科目的校对题目写入 <code>data/question-bank.json</code> 后重新加载。</p>" +
            "</div>" +
            "<ul class='empty-list'>" +
            "<li>六门范围固定，不接受 C 语言或其他扩展科目</li>" +
            "<li>只有 <code>status = verified</code> 的记录会进入抽题池</li>" +
            "<li>每条题目都必须补齐 <code>source.document / page / order</code></li>" +
            "</ul>" +
            "</article>";
    }

    function renderQuestionCard(question) {
        const progress = getQuestionProgress(question.id);
        const masteryLabel = progress.mastery ? MASTERY_MAP[progress.mastery].label : "未标注";
        const historyLine = progress.seenCount
            ? "历史掌握度： " + masteryLabel + " · 已记录 " + progress.seenCount + " 次训练"
            : progress.drawCount
                ? "历史掌握度： 未标注 · 已抽到 " + progress.drawCount + " 次，尚未完成正式自评"
            : "历史掌握度： 未标注 · 这道题还没有正式训练记录";

        const answerContentClass = state.session.answerVisible ? "answer-content" : "answer-content is-hidden";
        const showAnswerLabel = state.session.answerVisible ? "答案已展开" : "显示参考答案";

        elements.questionShell.innerHTML =
            "<article class='question-card'>" +
            "<header class='question-top'>" +
            "<span class='subject-pill' data-subject='" + escapeHtml(question.subject) + "'>" + escapeHtml(question.subject) + "</span>" +
            "<span class='meta-item'>ID " + escapeHtml(question.id) + "</span>" +
            "<span class='meta-item'>" + escapeHtml(question.source.document) + " · P" + question.source.page + " · #" + question.source.order + "</span>" +
            "</header>" +
            "<div class='question-body'>" +
            "<section>" +
            "<p class='question-label'>题目</p>" +
            "<h3 class='question-title'>" + renderMathText(question.question) + "</h3>" +
            "<p class='question-note'>先自己按“定义 / 核心点 / 常见追问 / 例子”组织 60 到 90 秒回答，再展开参考答案。</p>" +
            "</section>" +
            "<section class='answer-panel " + (state.session.answerVisible ? "" : "locked") + "'>" +
            "<div class='answer-head'>" +
            "<div>" +
            "<p class='question-label'>参考答案</p>" +
            "<p class='question-note'>答案展开前不会泄露内容。</p>" +
            "</div>" +
            "<button class='answer-btn' type='button' data-action='show-answer' " + (state.session.answerVisible ? "disabled" : "") + ">" + showAnswerLabel + "</button>" +
            "</div>" +
            "<div class='" + answerContentClass + "'>" + renderMathText(question.referenceAnswer) + "</div>" +
            "</section>" +
            "<section class='assessment-panel'>" +
            "<div class='assessment-head'>" +
            "<div>" +
            "<p class='question-label'>本轮自评</p>" +
            "<p class='assessment-note'>参考答案展开后再标记，系统会把“不会 / 模糊”的题目回抽得更频繁。</p>" +
            "</div>" +
            "<span class='history-badge'>" + escapeHtml(historyLine) + "</span>" +
            "</div>" +
            "<div class='assessment-grid'>" +
            createMasteryButtonMarkup("weak", progress.mastery, state.session.answerVisible) +
            createMasteryButtonMarkup("fuzzy", progress.mastery, state.session.answerVisible) +
            createMasteryButtonMarkup("solid", progress.mastery, state.session.answerVisible) +
            "</div>" +
            "<p class='history-line'>最近重复窗口： 10 题。若当前科目题量太少，系统会在必要时放宽去重限制。</p>" +
            "</section>" +
            "</div>" +
            "</article>";

        enhanceMathRendering(elements.questionShell);
    }

    function createMasteryButtonMarkup(level, activeMastery, enabled) {
        const meta = MASTERY_MAP[level];
        const activeClass = activeMastery === level ? " active" : "";
        const disabled = enabled ? "" : "disabled";
        return (
            "<button class='mastery-btn" + activeClass + "' type='button' data-mastery='" + level + "' data-level='" + level + "' " + disabled + ">" +
            "<strong>" + meta.label + "</strong>" +
            "<span>" + meta.hint + "</span>" +
            "</button>"
        );
    }

    function getFilteredQuestions() {
        return state.bank.filter(questionMatchesSelection);
    }

    function questionMatchesSelection(question) {
        return state.selectedSubject === "all" || question.subject === state.selectedSubject;
    }

    function getQuestionProgress(questionId) {
        const saved = state.progress.questions[questionId];
        if (!saved || typeof saved !== "object") {
            return {
                mastery: "",
                drawCount: 0,
                seenCount: 0,
                lastSeenAt: null
            };
        }

        return {
            mastery: trimString(saved.mastery),
            drawCount: toPositiveInteger(saved.drawCount) || 0,
            seenCount: toPositiveInteger(saved.seenCount) || 0,
            lastSeenAt: trimString(saved.lastSeenAt) || null
        };
    }

    function getUnseenQuestions(questions) {
        return questions.filter(function (question) {
            return getQuestionProgress(question.id).drawCount === 0;
        });
    }

    function markQuestionDrawn(questionId) {
        const currentProgress = getQuestionProgress(questionId);
        state.progress.questions[questionId] = {
            mastery: currentProgress.mastery,
            drawCount: currentProgress.drawCount + 1,
            seenCount: currentProgress.seenCount,
            lastSeenAt: currentProgress.lastSeenAt
        };
        persistProgress();
    }

    function pushRecentQuestion(questionId) {
        const nextRecent = state.session.recentQuestionIds.filter(function (id) {
            return id !== questionId;
        });
        nextRecent.push(questionId);
        state.session.recentQuestionIds = nextRecent.slice(-RECENT_WINDOW_SIZE);
    }

    async function buildQuestionBankFromMarkdownFiles(files) {
        const filesBySubject = new Map();

        files.forEach(function (file) {
            const subject = extractSubjectFromMarkdownFileName(file.name);
            if (subject) {
                filesBySubject.set(subject, file);
            }
        });

        const availableSubjects = SUBJECT_WHITELIST.filter(function (subject) {
            return filesBySubject.has(subject);
        });

        if (!availableSubjects.length) {
            throw new Error("未在所选文件夹中识别到六门白名单内的 Markdown 文件。请确保文件名直接使用科目名，例如“数据库.md”。");
        }

        const counters = Object.fromEntries(SUBJECT_WHITELIST.map(function (subject) {
            return [subject, 0];
        }));
        const globalSeen = new Set();
        const payload = [];
        let skippedDuplicate = 0;
        let skippedEmpty = 0;

        for (const subject of availableSubjects) {
            const file = filesBySubject.get(subject);
            const content = await file.text();
            const questions = parseMarkdownQuestions(content);

            questions.forEach(function (item) {
                const normalizedKey = subject + "::" + normalizeText(item.question);
                if (!item.answer) {
                    skippedEmpty += 1;
                    return;
                }

                if (globalSeen.has(normalizedKey)) {
                    skippedDuplicate += 1;
                    return;
                }

                globalSeen.add(normalizedKey);
                counters[subject] += 1;

                payload.push({
                    id: IMPORT_SUBJECT_PREFIX[subject] + "-" + String(counters[subject]).padStart(4, "0"),
                    subject: subject,
                    question: item.question,
                    referenceAnswer: item.answer,
                    source: {
                        document: file.name,
                        page: 1,
                        order: item.order,
                        locator: "第" + item.order + "题"
                    },
                    status: "verified",
                    keywords: [subject]
                });
            });
        }

        const folderLabel = extractFolderLabel(files);
        return {
            payload: payload,
            sourceLabel: folderLabel + "（Markdown 导入：" + payload.length + " 题，跳过重复 " + skippedDuplicate + "，空答案 " + skippedEmpty + "）"
        };
    }

    function parseMarkdownQuestions(content) {
        const lines = String(content || "").replace(/^\uFEFF/, "").split(/\r?\n/);
        const questions = [];
        let current = null;

        lines.forEach(function (line) {
            const match = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
            if (match) {
                flushCurrent();
                current = {
                    order: Number(match[1]),
                    questionRaw: match[2],
                    answerLines: []
                };
                return;
            }

            if (current) {
                current.answerLines.push(line);
            }
        });

        flushCurrent();
        return questions;

        function flushCurrent() {
            if (!current) {
                return;
            }

            const question = cleanMarkdownQuestion(current.questionRaw);
            const answer = cleanMarkdownAnswer(current.answerLines);
            if (question) {
                questions.push({
                    order: current.order,
                    question: question,
                    answer: answer
                });
            }

            current = null;
        }
    }

    function cleanMarkdownQuestion(value) {
        let result = stripMarkdown(value || "");
        result = result.replace(/\s*[（(][^)）]*[)）]\s*\d+\s*题?\s*$/u, "");
        result = result.replace(/\s*\d+\s*题?\s*$/u, "");
        result = result.replace(/\s+/g, " ").trim();
        return result;
    }

    function cleanMarkdownAnswer(lines) {
        const cleanedLines = (lines || [])
            .map(function (line) {
                return line.replace(/\t/g, "    ");
            })
            .map(stripMarkdown)
            .map(function (line) {
                return line.replace(/!\[\[[^\]]+\]\]/g, "").replace(/!\[[^\]]*\]\([^)]+\)/g, "");
            })
            .map(function (line) {
                return line.replace(/\*{4,}/g, "").replace(/\s+$/g, "");
            });

        while (cleanedLines.length && !cleanedLines[0].trim()) {
            cleanedLines.shift();
        }

        while (cleanedLines.length && !cleanedLines[cleanedLines.length - 1].trim()) {
            cleanedLines.pop();
        }

        const compact = [];
        let previousBlank = false;

        cleanedLines.forEach(function (line) {
            const isBlank = !line.trim();
            if (isBlank && previousBlank) {
                return;
            }

            compact.push(line);
            previousBlank = isBlank;
        });

        return compact.join("\n").trim();
    }

    function extractSubjectFromMarkdownFileName(fileName) {
        const baseName = String(fileName || "").replace(/\.[^.]+$/, "").trim();
        return SUBJECT_WHITELIST.includes(baseName) ? baseName : "";
    }

    function extractFolderLabel(files) {
        const firstFile = files && files[0];
        if (firstFile && typeof firstFile.webkitRelativePath === "string" && firstFile.webkitRelativePath.includes("/")) {
            return firstFile.webkitRelativePath.split("/")[0];
        }

        return "本地 Markdown 文件夹";
    }

    function stripMarkdown(value) {
        return String(value || "")
            .replace(/\*\*/g, "")
            .replace(/__+/g, "")
            .replace(/^#{1,6}\s*/g, "")
            .replace(/^\s*[-*]\s+/g, "")
            .replace(/`{3,}/g, "")
            .replace(/\s+$/g, "");
    }

    function renderMathText(value) {
        return escapeHtml(value);
    }

    function enhanceMathRendering(container) {
        if (!container || typeof window.renderMathInElement !== "function") {
            return;
        }

        window.renderMathInElement(container, {
            delimiters: [
                { left: "$$", right: "$$", display: true },
                { left: "$", right: "$", display: false },
                { left: "\\(", right: "\\)", display: false },
                { left: "\\[", right: "\\]", display: true }
            ],
            throwOnError: false,
            strict: "ignore",
            trust: false
        });
    }

    function loadProgress() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.progress));
            if (parsed && typeof parsed === "object" && parsed.questions && typeof parsed.questions === "object") {
                return {
                    questions: parsed.questions
                };
            }
        } catch (error) {
            console.error(error);
        }

        return createDefaultProgress();
    }

    function loadSession() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.session));
            if (parsed && typeof parsed === "object") {
                return {
                    selectedSubject: normalizeSelectedSubject(parsed.selectedSubject),
                    trainingMode: normalizeTrainingMode(parsed.trainingMode),
                    recentQuestionIds: Array.isArray(parsed.recentQuestionIds)
                        ? parsed.recentQuestionIds.filter(function (item) { return typeof item === "string" && item; }).slice(-RECENT_WINDOW_SIZE)
                        : [],
                    currentQuestionId: trimString(parsed.currentQuestionId) || null,
                    askedCount: toPositiveInteger(parsed.askedCount) || 0,
                    answerVisible: Boolean(parsed.answerVisible),
                    currentAssessmentRecorded: Boolean(parsed.currentAssessmentRecorded)
                };
            }
        } catch (error) {
            console.error(error);
        }

        return createDefaultSession();
    }

    function createDefaultProgress() {
        return {
            questions: {}
        };
    }

    function createDefaultSession() {
        return {
            selectedSubject: "all",
            trainingMode: "survey",
            recentQuestionIds: [],
            currentQuestionId: null,
            askedCount: 0,
            answerVisible: false,
            currentAssessmentRecorded: false
        };
    }

    function persistProgress() {
        localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(state.progress));
    }

    function persistSession() {
        localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.session));
    }

    function normalizeSelectedSubject(subject) {
        return SUBJECT_WHITELIST.includes(subject) ? subject : "all";
    }

    function normalizeTrainingMode(mode) {
        return Object.prototype.hasOwnProperty.call(TRAINING_MODES, mode) ? mode : "survey";
    }

    function trimString(value) {
        return typeof value === "string" ? value.trim() : "";
    }

    function toPositiveInteger(value) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : 0;
    }

    function normalizeText(value) {
        return trimString(value).replace(/\s+/g, "");
    }

    function daysSince(isoTime) {
        if (!isoTime) {
            return 0;
        }

        const time = Date.parse(isoTime);
        if (Number.isNaN(time)) {
            return 0;
        }

        const difference = Date.now() - time;
        return difference > 0 ? Math.floor(difference / (1000 * 60 * 60 * 24)) : 0;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
}());
