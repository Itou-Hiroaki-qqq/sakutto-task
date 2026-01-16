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
        
        // cron-job.orgは正確に5分ごとに実行されるため、現在時刻の5分刻み時刻のみをチェック
        // これにより、指定した時刻に1回だけ通知が送信される
        const timeChecks: Array<{ date: Date; time: string }> = [];
        const checkTimeStr = format(roundedTime, 'HH:mm');
        timeChecks.push({ date: roundedTime, time: checkTimeStr });
        
        const currentDate = format(roundedTime, 'yyyy-MM-dd');
        const currentTime = format(roundedTime, 'HH:mm');
        
        console.log(`[Cron] UTC time: ${format(now, 'yyyy-MM-dd HH:mm')} (UTC)`);
        console.log(`[Cron] JST time: ${format(jstTime, 'yyyy-MM-dd HH:mm')} (JST)`);
        console.log(`[Cron] Checking notifications for time slot: ${format(roundedTime, 'yyyy-MM-dd')} ${checkTimeStr}`);

        // 現在時刻の5分刻み時刻について通知を送信
        const { date, time } = timeChecks[0];
        const dateStr = format(date, 'yyyy-MM-dd');
        console.log(`[Cron] Sending notifications for ${dateStr} ${time}`);
        console.log(`[Cron] Date object details:`, {
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
        console.log(`[Cron] Result for ${dateStr} ${time}:`, {
            emailCount: result.emailCount,
            webPushCount: result.webPushCount,
            errorsCount: result.errors.length
        });

        return NextResponse.json({
            success: true,
            date: currentDate,
            time: currentTime,
            emailCount: result.emailCount,
            webPushCount: result.webPushCount,
            errors: result.errors,
        }, {
            headers: {
                'Content-Type': 'application/json',
            },
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
