import { NextRequest, NextResponse } from 'next/server';
import { sendNotificationsForDateTime } from '@/lib/notifications';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// cron-job.orgから呼び出されるエンドポイント
// このエンドポイントは5分ごとに実行される想定
export async function GET(request: NextRequest) {
    console.log(`[Cron] ===== Notification endpoint called =====`);
    console.log(`[Cron] Request URL: ${request.url}`);
    console.log(`[Cron] Request method: ${request.method}`);
    console.log(`[Cron] Request timestamp: ${new Date().toISOString()}`);
    
    try {
        // 認証（セキュリティのため）
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;
        
        console.log(`[Cron] Auth check: cronSecret exists=${!!cronSecret}, authHeader exists=${!!authHeader}`);
        
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            console.error(`[Cron] Unauthorized access attempt`);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        console.log(`[Cron] Authentication passed`);

        // 現在の日時を取得（UTC）
        const now = new Date();
        
        // 日本時間（JST）に変換
        const jstTime = toZonedTime(now, 'Asia/Tokyo');
        
        // 時刻を5分刻みに丸める
        const minutes = jstTime.getMinutes();
        const roundedMinutes = Math.floor(minutes / 5) * 5;
        const roundedTime = new Date(jstTime);
        roundedTime.setMinutes(roundedMinutes, 0, 0);
        
        // cron-job.orgは正確に5分ごとに実行されるため、現在時刻の前後5分をチェックするだけで十分
        // ただし、数秒～1分程度の遅延を考慮して、-5分～+5分の範囲をチェック
        const timeChecks: Array<{ date: Date; time: string }> = [];
        
        // 過去5分～未来5分の5分刻み時刻をチェック（合計3個の時刻: -5分, 0分（現在）, +5分）
        for (let offset = -5; offset <= 5; offset += 5) {
            const checkTime = new Date(roundedTime);
            checkTime.setMinutes(checkTime.getMinutes() + offset);
            // 日付が変わる場合は自動的に処理される（Dateオブジェクトが自動調整）
            const checkTimeStr = format(checkTime, 'HH:mm');
            timeChecks.push({ date: checkTime, time: checkTimeStr });
        }
        
        const currentDate = format(roundedTime, 'yyyy-MM-dd');
        const currentTime = format(roundedTime, 'HH:mm');
        
        console.log(`[Cron] UTC time: ${format(now, 'yyyy-MM-dd HH:mm')} (UTC)`);
        console.log(`[Cron] JST time: ${format(jstTime, 'yyyy-MM-dd HH:mm')} (JST)`);
        console.log(`[Cron] Checking notifications for ${timeChecks.length} time slots:`, 
            timeChecks.map(t => `${format(t.date, 'yyyy-MM-dd')} ${t.time}`).join(', '));

        // 各時刻について通知を送信
        const results = await Promise.all(
            timeChecks.map(async ({ date, time }, index) => {
                const dateStr = format(date, 'yyyy-MM-dd');
                console.log(`[Cron] [${index + 1}/${timeChecks.length}] Sending notifications for ${dateStr} ${time}`);
                console.log(`[Cron] [${index + 1}/${timeChecks.length}] Date object details:`, {
                    dateISO: date.toISOString(),
                    dateStr,
                    time,
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    day: date.getDate(),
                    hour: date.getHours(),
                    minute: date.getMinutes()
                });
                const result = await sendNotificationsForDateTime(date, time);
                console.log(`[Cron] [${index + 1}/${timeChecks.length}] Result for ${dateStr} ${time}:`, {
                    emailCount: result.emailCount,
                    webPushCount: result.webPushCount,
                    errorsCount: result.errors.length
                });
                return result;
            })
        );
        
        // 結果を統合
        const result = {
            emailCount: results.reduce((sum, r) => sum + r.emailCount, 0),
            webPushCount: results.reduce((sum, r) => sum + r.webPushCount, 0),
            errors: results.flatMap(r => r.errors),
        };

        return NextResponse.json({
            success: true,
            date: currentDate,
            time: currentTime,
            emailCount: result.emailCount,
            webPushCount: result.webPushCount,
            errors: result.errors,
        });
    } catch (error) {
        console.error('Failed to process notifications:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
