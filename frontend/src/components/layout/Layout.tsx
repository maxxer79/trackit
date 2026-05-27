import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import MobileTabBar from './MobileTabBar';

export default function Layout() {
  return (
    <div className="min-h-screen bg-black flex flex-col">
      <Navbar />
      <main className="flex-1 pt-16 pb-20 sm:pb-0">
        <Outlet />
      </main>
      <MobileTabBar />
    </div>
  );
}
