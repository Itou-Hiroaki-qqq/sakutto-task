/**
 * タイトルから時間を抽出して、比較可能な数値（分単位）に変換する
 * 対応形式：
 * - 「9:00」「14:00」（半角数字とコロン）
 * - 「十時半」（漢数字）
 * - 「12時30分」（数字+時+分）
 * - 「１５時４５分」（全角数字）
 */

// 全角数字を半角数字に変換
function toHalfWidth(str: string): string {
    return str.replace(/[０-９]/g, (s) => {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    });
}

// 漢数字を数値に変換
const kanjiNumbers: { [key: string]: number } = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15, '十六': 16, '十七': 17, '十八': 18, '十九': 19,
    '二十': 20, '二十一': 21, '二十二': 22, '二十三': 23
};

function kanjiToNumber(kanji: string): number | null {
    if (kanjiNumbers[kanji] !== undefined) {
        return kanjiNumbers[kanji];
    }
    return null;
}

// 「半」を30分に変換
function parseHalf(str: string): number {
    return str.includes('半') ? 30 : 0;
}

/**
 * タイトルから時間を抽出して、分単位の数値に変換
 * 例：「9:00 洗濯」→ 540（9時0分 = 540分）
 * 例：「十時半 会議」→ 630（10時30分 = 630分）
 * 時間が見つからない場合は null を返す
 */
export function extractTimeInMinutes(title: string): number | null {
    // 全角数字を半角に変換
    const normalizedTitle = toHalfWidth(title);

    // パターン1: 「9:00」「14:30」などの形式（HH:mm）
    let match = normalizedTitle.match(/\b(\d{1,2}):(\d{2})\b/);
    if (match) {
        const hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return hour * 60 + minute;
        }
    }

    // パターン2: 「9時30分」「14時45分」などの形式
    match = normalizedTitle.match(/(\d{1,2})時(\d{1,2})分/);
    if (match) {
        const hour = parseInt(match[1], 10);
        const minute = parseInt(match[2], 10);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return hour * 60 + minute;
        }
    }

    // パターン3: 「9時」「14時」などの形式（分が省略されている場合は0分）
    match = normalizedTitle.match(/(\d{1,2})時(?!\d)/);
    if (match) {
        const hour = parseInt(match[1], 10);
        if (hour >= 0 && hour <= 23) {
            return hour * 60;
        }
    }

    // パターン4: 「十時半」「九時」などの漢数字形式
    match = normalizedTitle.match(/([一二三四五六七八九十]+)時(半)?/);
    if (match) {
        const kanjiHour = match[1];
        const hour = kanjiToNumber(kanjiHour);
        if (hour !== null && hour >= 0 && hour <= 23) {
            const minute = match[2] === '半' ? 30 : 0;
            return hour * 60 + minute;
        }
    }

    // パターン5: 「十時30分」「九時45分」などの漢数字+数字の分
    match = normalizedTitle.match(/([一二三四五六七八九十]+)時(\d{1,2})分/);
    if (match) {
        const kanjiHour = match[1];
        const hour = kanjiToNumber(kanjiHour);
        const minute = parseInt(match[2], 10);
        if (hour !== null && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return hour * 60 + minute;
        }
    }

    // パターン6: 「９００」「１４２５」など（全角数字、4桁）
    match = title.match(/[０-９]{4}/);
    if (match) {
        const halfWidth = toHalfWidth(match[0]);
        const hour = parseInt(halfWidth.substring(0, 2), 10);
        const minute = parseInt(halfWidth.substring(2, 4), 10);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return hour * 60 + minute;
        }
    }

    // パターン7: 「９時３０分」など（全角数字）
    match = title.match(/[０-９]{1,2}時[０-９]{1,2}分/);
    if (match) {
        const halfWidth = toHalfWidth(match[0]);
        const hourMatch = halfWidth.match(/(\d{1,2})時/);
        const minuteMatch = halfWidth.match(/(\d{1,2})分/);
        if (hourMatch && minuteMatch) {
            const hour = parseInt(hourMatch[1], 10);
            const minute = parseInt(minuteMatch[1], 10);
            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                return hour * 60 + minute;
            }
        }
    }

    return null;
}

/**
 * タイトルに時間表示が含まれているかどうかを判定
 */
export function hasTimeInTitle(title: string): boolean {
    return extractTimeInMinutes(title) !== null;
}
