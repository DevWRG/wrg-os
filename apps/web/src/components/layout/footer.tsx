// Footer bar ala Adminator (.d-footer): kiri = kredit + link brand (primary),
// kanan = meta build monospace. Di-port dari template 2026 (_shell.scss) ke
// utilitas Tailwind + token shadcn, dengan konten WRG (bukan Colorlib/4.1.5).

const APP_VERSION = "v0.1.0"; // selaras dengan label versi di app-sidebar

export function Footer() {
  return (
    <footer className="text-muted-foreground flex flex-col items-start gap-2.5 border-t px-4 py-5 text-xs sm:flex-row sm:items-center sm:justify-between md:px-6">
      <div>
        © 2026 ·{" "}
        <a
          href="https://wahanalifeline.co.id"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary-dark font-semibold"
        >
          Wahana Lifeline
        </a>{" "}
        · WRG OS
      </div>
      <div className="text-muted-foreground/70 flex gap-5 font-mono text-[10.5px] tracking-wider uppercase">
        <span>{APP_VERSION}</span>
        <span>dev build</span>
      </div>
    </footer>
  );
}
