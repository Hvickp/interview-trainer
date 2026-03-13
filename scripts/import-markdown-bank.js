"use strict";

const fs = require("fs");
const path = require("path");

const SUBJECTS = [
    "数据结构",
    "计算机组成原理",
    "操作系统",
    "计算机网络",
    "数据库",
    "软件工程"
];

const SUBJECT_PREFIX = {
    "数据结构": "ds",
    "计算机组成原理": "co",
    "操作系统": "os",
    "计算机网络": "net",
    "数据库": "db",
    "软件工程": "se"
};

const DEFAULT_OUTPUT_PATH = "data/question-bank.json";

const inputArg = process.argv[2];
const outputArg = process.argv[3] || DEFAULT_OUTPUT_PATH;

if (!inputArg || inputArg === "--help" || inputArg === "-h") {
    printUsageAndExit(!inputArg ? 1 : 0);
}

const inputDir = path.resolve(process.cwd(), inputArg);
const outputPath = path.resolve(process.cwd(), outputArg);

main();

function main() {
    if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
        throw new Error("导入目录不存在或不是文件夹： " + inputDir);
    }

    const markdownFiles = fs.readdirSync(inputDir, "utf8")
        .filter(function (name) {
            return name.toLowerCase().endsWith(".md");
        })
        .sort(function (left, right) {
            return left.localeCompare(right, "zh-CN");
        });

    const filesBySubject = new Map();
    markdownFiles.forEach(function (fileName) {
        const subject = path.basename(fileName, ".md").trim();
        if (SUBJECTS.includes(subject)) {
            filesBySubject.set(subject, path.join(inputDir, fileName));
        }
    });

    const missingSubjects = SUBJECTS.filter(function (subject) {
        return !filesBySubject.has(subject);
    });

    if (missingSubjects.length) {
        throw new Error("缺少以下科目的 Markdown： " + missingSubjects.join("、"));
    }

    const importResult = importSubjects(filesBySubject);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(importResult.records, null, 4) + "\n", "utf8");

    printSummary(importResult);
    console.log("已写入：", outputPath);
}

function importSubjects(filesBySubject) {
    const summary = [];
    const globalSeen = new Set();
    const counters = Object.fromEntries(SUBJECTS.map(function (subject) {
        return [subject, 0];
    }));

    const records = [];

    SUBJECTS.forEach(function (subject) {
        const filePath = filesBySubject.get(subject);
        const parsed = parseMarkdownFile(filePath);

        parsed.questions.forEach(function (question) {
            const normalizedKey = subject + "::" + normalizeText(question.question);
            if (!question.answer) {
                parsed.skippedEmpty += 1;
                return;
            }

            if (globalSeen.has(normalizedKey)) {
                parsed.skippedDuplicate += 1;
                return;
            }

            globalSeen.add(normalizedKey);
            counters[subject] += 1;

            records.push({
                id: SUBJECT_PREFIX[subject] + "-" + String(counters[subject]).padStart(4, "0"),
                subject: subject,
                question: question.question,
                referenceAnswer: question.answer,
                source: {
                    document: path.basename(filePath),
                    page: 1,
                    order: question.order,
                    locator: "第" + question.order + "题"
                },
                status: "verified",
                keywords: [subject]
            });
        });

        summary.push({
            subject: subject,
            file: path.basename(filePath),
            imported: counters[subject],
            skippedDuplicate: parsed.skippedDuplicate,
            skippedEmpty: parsed.skippedEmpty
        });
    });

    return {
        records: records,
        summary: summary
    };
}

function parseMarkdownFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const lines = content.split(/\r?\n/);
    const questions = [];

    let current = null;

    lines.forEach(function (line) {
        const questionMatch = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
        if (questionMatch) {
            flushCurrent();
            current = {
                order: Number(questionMatch[1]),
                questionRaw: questionMatch[2],
                answerLines: []
            };
            return;
        }

        if (current) {
            current.answerLines.push(line);
        }
    });

    flushCurrent();

    return {
        questions: questions,
        skippedDuplicate: 0,
        skippedEmpty: 0
    };

    function flushCurrent() {
        if (!current) {
            return;
        }

        const cleanedQuestion = cleanQuestion(current.questionRaw);
        const cleanedAnswer = cleanAnswer(current.answerLines);

        if (cleanedQuestion) {
            questions.push({
                order: current.order,
                question: cleanedQuestion,
                answer: cleanedAnswer
            });
        }

        current = null;
    }
}

function cleanQuestion(value) {
    let result = stripMarkdown(value || "");
    result = result.replace(/\s*[（(][^)）]*[)）]\s*\d+\s*题?\s*$/u, "");
    result = result.replace(/\s*\d+\s*题?\s*$/u, "");
    result = result.replace(/\s+/g, " ").trim();
    return result;
}

function cleanAnswer(lines) {
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

function stripMarkdown(value) {
    return String(value || "")
        .replace(/\*\*/g, "")
        .replace(/__+/g, "")
        .replace(/^#{1,6}\s*/g, "")
        .replace(/^\s*[-*]\s+/g, "")
        .replace(/`{3,}/g, "")
        .replace(/\s+$/g, "");
}

function normalizeText(value) {
    return String(value || "")
        .replace(/\s+/g, "")
        .replace(/[（(][^)）]*[)）]\s*\d*\s*题?/g, "")
        .trim();
}

function printSummary(importResult) {
    console.log("Markdown 题库导入完成");
    console.log("正式题目总数：", importResult.records.length);

    importResult.summary.forEach(function (item) {
        console.log(
            " - " +
            item.subject +
            "：导入 " + item.imported +
            "，跳过重复 " + item.skippedDuplicate +
            "，跳过空答案 " + item.skippedEmpty
        );
    });
}
function printUsageAndExit(exitCode) {
    console.log("用法： node scripts/import-markdown-bank.js <markdown-folder> [output-json]");
    console.log("示例： node scripts/import-markdown-bank.js \"./markdown-bank\" data/question-bank.json");
    process.exit(exitCode);
}


