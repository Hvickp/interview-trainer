"use strict";

const fs = require("fs");
const path = require("path");

const SUBJECT_WHITELIST = [
    "数据结构",
    "计算机组成原理",
    "操作系统",
    "计算机网络",
    "数据库",
    "软件工程"
];

const ALLOWED_STATUSES = new Set(["draft", "verified", "invalid"]);

const targetPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.resolve(process.cwd(), "data/question-bank.json");

try {
    const payload = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    const result = validateQuestionBank(payload);

    printSummary(targetPath, result);

    if (result.errors.length) {
        process.exitCode = 1;
    }
} catch (error) {
    console.error("校验失败：", error.message);
    process.exitCode = 1;
}

function validateQuestionBank(payload) {
    const result = {
        errors: [],
        counts: {
            verified: 0,
            draft: 0,
            invalid: 0
        },
        perSubject: Object.fromEntries(SUBJECT_WHITELIST.map(function (subject) {
            return [subject, 0];
        }))
    };

    if (!Array.isArray(payload)) {
        result.errors.push("题库根节点必须是数组。");
        return result;
    }

    const idSet = new Set();
    const duplicateQuestionSet = new Set();

    payload.forEach(function (item, index) {
        const prefix = "第 " + (index + 1) + " 条记录";

        if (!item || typeof item !== "object" || Array.isArray(item)) {
            result.errors.push(prefix + " 不是对象。");
            return;
        }

        const record = {
            id: trimString(item.id),
            subject: trimString(item.subject),
            question: trimString(item.question),
            referenceAnswer: trimString(item.referenceAnswer),
            status: trimString(item.status).toLowerCase(),
            source: {
                document: trimString(item.source && item.source.document),
                page: toPositiveInteger(item.source && item.source.page),
                order: toPositiveInteger(item.source && item.source.order)
            }
        };

        const issues = [];

        if (!record.id) {
            issues.push("缺少 id");
        } else if (idSet.has(record.id)) {
            issues.push("id 重复");
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

        const duplicateKey = record.subject + "::" + normalizeText(record.question);
        if (record.subject && record.question && duplicateQuestionSet.has(duplicateKey)) {
            issues.push("同科目题目重复");
        }

        if (issues.length) {
            result.errors.push(prefix + "（" + (record.id || "无 id") + "）： " + issues.join("；"));
            return;
        }

        idSet.add(record.id);
        duplicateQuestionSet.add(duplicateKey);

        result.counts[record.status] += 1;

        if (record.status === "verified") {
            result.perSubject[record.subject] += 1;
        }
    });

    return result;
}

function printSummary(filePath, result) {
    console.log("题库文件：", filePath);
    console.log("verified：", result.counts.verified);
    console.log("draft：", result.counts.draft);
    console.log("invalid：", result.counts.invalid);
    console.log("各科 verified 数量：");

    SUBJECT_WHITELIST.forEach(function (subject) {
        console.log(" - " + subject + "： " + result.perSubject[subject]);
    });

    if (!result.errors.length) {
        console.log("校验结果：通过");
        return;
    }

    console.log("校验结果：失败");
    result.errors.forEach(function (message) {
        console.log(" - " + message);
    });
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
