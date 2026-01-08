import { Holiday } from '@/types/database';

// 日付をキーとしたマップを作成（高速検索用）
const holidayMap = new Map<string, Holiday>();

function formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 祝日データを初期化
function initializeHolidays() {
    const holidays = generateHolidays();
    holidays.forEach(holiday => {
        const key = formatDateKey(holiday.date);
        holidayMap.set(key, holiday);
    });
}

// 初期化実行
initializeHolidays();

export function getHoliday(date: Date): Holiday | undefined {
    const key = formatDateKey(date);
    return holidayMap.get(key);
}

export function isHoliday(date: Date): boolean {
    return getHoliday(date) !== undefined;
}

// 現在年から20年間の祝日を動的に生成する関数
function generateHolidays(): Holiday[] {
    const generated: Holiday[] = [];
    const currentYear = new Date().getFullYear();

    // 春分の日・秋分の日の近似値（実際のアプリでは正確な計算式を使用）
    const springEquinoxDates: { [key: number]: number } = {
        2026: 20, 2027: 21, 2028: 20, 2029: 20, 2030: 20,
        2031: 21, 2032: 20, 2033: 20, 2034: 20, 2035: 21,
        2036: 20, 2037: 20, 2038: 20, 2039: 21, 2040: 20,
        2041: 20, 2042: 20, 2043: 21, 2044: 20, 2045: 20, 2046: 20
    };

    const autumnEquinoxDates: { [key: number]: number } = {
        2026: 23, 2027: 23, 2028: 22, 2029: 23, 2030: 23,
        2031: 23, 2032: 22, 2033: 23, 2034: 23, 2035: 23,
        2036: 22, 2037: 23, 2038: 23, 2039: 23, 2040: 22,
        2041: 23, 2042: 23, 2043: 23, 2044: 22, 2045: 23, 2046: 23
    };

    for (let year = currentYear; year <= currentYear + 20; year++) {
        // 固定日付の祝日
        generated.push({ date: new Date(year, 0, 1), name: '元日', type: 'national' });
        generated.push({ date: new Date(year, 0, 2), name: '銀行休業日', type: 'bank' });
        generated.push({ date: new Date(year, 0, 3), name: '銀行休業日', type: 'bank' });
        generated.push({ date: new Date(year, 1, 11), name: '建国記念の日', type: 'national' });
        generated.push({ date: new Date(year, 3, 29), name: '昭和の日', type: 'national' });
        generated.push({ date: new Date(year, 4, 3), name: '憲法記念日', type: 'national' });
        generated.push({ date: new Date(year, 4, 4), name: 'みどりの日', type: 'national' });
        generated.push({ date: new Date(year, 4, 5), name: 'こどもの日', type: 'national' });
        generated.push({ date: new Date(year, 9, 12), name: 'スポーツの日', type: 'national' });
        generated.push({ date: new Date(year, 10, 3), name: '文化の日', type: 'national' });
        generated.push({ date: new Date(year, 10, 23), name: '勤労感謝の日', type: 'national' });

        // 計算が必要な祝日
        // 成人の日: 1月第2月曜日
        generated.push({ date: getNthMondayOfMonth(year, 0, 2), name: '成人の日', type: 'national' });

        // 春分の日
        if (springEquinoxDates[year]) {
            generated.push({ date: new Date(year, 2, springEquinoxDates[year]), name: '春分の日', type: 'national' });
        }

        // 海の日: 7月第3月曜日
        generated.push({ date: getNthMondayOfMonth(year, 6, 3), name: '海の日', type: 'national' });

        // 山の日: 8月11日
        generated.push({ date: new Date(year, 7, 11), name: '山の日', type: 'national' });

        // 敬老の日: 9月第3月曜日
        generated.push({ date: getNthMondayOfMonth(year, 8, 3), name: '敬老の日', type: 'national' });

        // 秋分の日
        if (autumnEquinoxDates[year]) {
            generated.push({ date: new Date(year, 8, autumnEquinoxDates[year]), name: '秋分の日', type: 'national' });
        }
    }

    return generated;
}

// 指定した年月の第N月曜日を取得
function getNthMondayOfMonth(year: number, month: number, n: number): Date {
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay();
    const daysUntilMonday = (1 - firstDayOfWeek + 7) % 7;
    const nthMonday = 1 + daysUntilMonday + (n - 1) * 7;
    return new Date(year, month, nthMonday);
}

