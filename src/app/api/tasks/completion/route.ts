import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toggleTaskCompletion } from '@/lib/tasks';

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { taskId, date, completed } = body;

        if (!taskId || !date || typeof completed !== 'boolean') {
            return NextResponse.json(
                { error: 'Invalid parameters' },
                { status: 400 }
            );
        }

        const taskDate = new Date(date);
        await toggleTaskCompletion(taskId, taskDate, completed);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error toggling task completion:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

