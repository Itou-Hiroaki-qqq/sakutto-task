import Header from './Header';
import Footer from './Footer';

interface LayoutProps {
    children: React.ReactNode;
    currentDate?: Date;
    onDateChange?: (date: Date) => void;
}

export default function Layout({ children, currentDate, onDateChange }: LayoutProps) {
    return (
        <div className="min-h-screen flex flex-col">
            <Header currentDate={currentDate} onDateChange={onDateChange} />
            <main className="flex-1">{children}</main>
            <Footer />
        </div>
    );
}

