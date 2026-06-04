import type { Metadata } from 'next';
import MainApp from '@/components/MainApp'; // Menggunakan import standar

// Konfigurasi SEO agar Funfram.com mudah ditemukan di Google Search
export const metadata: Metadata = {
  title: 'Funfram.com - Random Video Chat & Multiplayer Mini Games',
  description: 'Temui orang-orang baru secara acak melalui video chat real-time di Funfram.com. Mainkan mini games multiplayer seru bersama teman atau lawan bicara baru Anda secara instan!',
  keywords: ['video chat random', 'ometv alternatif', 'game online multiplayer', 'chat gratis', 'funfram'],
};

export default function Home() {
  return (
    <main className="w-screen h-screen bg-black select-none">
      {/* Teks Tersembunyi Aksesibilitas (Membantu Googlebot membaca konteks web) */}
      <h1 className="sr-only">Funfram - Platform Video Chat Acak & Mini Games Real-time</h1>
      <p className="sr-only">Selamat datang di Funfram.com. Tempat gratis mencari teman baru, membuat lobi grup, dan bermain game multiplayer instan.</p>
      
      {/* Tampilan Utama Kamera dan Tombol Kontrol */}
      <MainApp />
    </main>
  );
}
