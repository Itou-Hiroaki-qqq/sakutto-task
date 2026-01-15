import { NextRequest, NextResponse } from 'next/server';
import { sendNotificationsForDateTime } from '@/lib/notifications';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// GitHub Actions Cron Jobから呼び出されるエンドポイント
// このエンドポイントは5分ごとに実行される想定
export async function GET(request: NextRequest) {
    try {
        // 認証（セキュリティのため）
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;
        
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 現在の日時を取得（UTC）
        const now = new Date();
        
        // 日本時間（JST）に変換
        const jstTime = toZonedTime(now, 'Asia/Tokyo');
        
        // 時刻を5分刻みに丸める（GitHub Actionsのcron実行遅延に対応）
        const minutes = jstTime.getMinutes();
        const roundedMinutes = Math.floor(minutes / 5) * 5;
        const roundedTime = new Date(jstTime);
        roundedTime.setMinutes(roundedMinutes, 0, 0);
        
        // 過去10分間のすべての5分刻み時刻をチェック（cron実行遅延に対応）
        // 現在時刻から過去に遡って、-10分, -5分, 0分, +5分の時刻をチェック
        const timeChecks: Array<{ date: Date; time: string }> = [];
        
        // 過去10分、過去5分、現在、未来5分の時刻をチェック
        for (let offset = -10; offset <= 5; offset += 5) {
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
            timeChecks.map(async ({ date, time }) => {
                console.log(`[Cron] Sending notifications for ${format(date, 'yyyy-MM-dd')} ${time}`);
                return await sendNotificationsForDateTime(date, time);
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
