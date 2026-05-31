import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "./components/Sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Empire Orquestador 2.0",
  description: "Fábrica Automatizada de Empresas Digitales",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${inter.className} bg-slate-950 text-slate-100 antialiased`}>
        {/* Estructura dividida: Sidebar fija a la izquierda, contenido dinámico a la derecha */}
        <div className="flex min-h-screen w-full overflow-hidden">
          
          {/* Componente de Navegación Matriz */}
          <Sidebar />

          {/* Contenedor Principal donde se renderizarán todas las pantallas */}
          <main className="flex-1 h-screen overflow-y-auto bg-slate-950">
            {children}
          </main>

        </div>
      </body>
    </html>
  );
}