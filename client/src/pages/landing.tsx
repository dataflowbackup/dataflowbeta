import { BarChart3, Shield, Zap, TrendingUp, FileText, Calculator, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: FileText,
    title: "Facturacion Completa",
    description: "Gestiona facturas de proveedores con soporte para todos los tipos de comprobantes electronicos",
  },
  {
    icon: Calculator,
    title: "Costos Automatizados",
    description: "Calculo automatico de costos unitarios basado en la ultima compra de cada insumo",
  },
  {
    icon: TrendingUp,
    title: "Balances P&G",
    description: "Estados de resultados mensuales con cierre correlativo automatico",
  },
  {
    icon: Building2,
    title: "Multi-Local",
    description: "Administra multiples locales y puntos de venta desde una sola plataforma",
  },
  {
    icon: Shield,
    title: "Seguridad Multi-Rol",
    description: "Control de acceso granular con roles de Encargado, Socio, Gerente y Contador",
  },
  {
    icon: Zap,
    title: "Importacion Inteligente",
    description: "Importa extractos bancarios y ventas desde Excel con matching automatico",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BarChart3 className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold">Data Flow</span>
          </div>
          <a href="/auth">
            <Button data-testid="button-login">Iniciar Sesion</Button>
          </a>
        </div>
      </header>

      <main>
        <section className="relative py-20 lg:py-32 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
          <div className="container mx-auto px-6 relative">
            <div className="max-w-3xl mx-auto text-center">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
                Gestion Financiera
                <span className="text-primary block mt-2">para Gastronomia</span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                Plataforma integral para gestionar facturacion, costos de recetas, balances y 
                reportes financieros. Todo en un solo lugar, con la precision que tu negocio necesita.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a href="/auth">
                  <Button size="lg" className="w-full sm:w-auto px-8" data-testid="button-cta-login">
                    Comenzar Ahora
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 bg-card/30">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold mb-4">Todo lo que necesitas</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Una suite completa de herramientas diseñadas especificamente para la gestion 
                financiera de negocios gastronomicos.
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((feature, index) => (
                <Card key={index} className="border-0 bg-card hover-elevate transition-all duration-200">
                  <CardContent className="p-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                      <feature.icon className="h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-6">
            <div className="max-w-4xl mx-auto">
              <div className="grid md:grid-cols-3 gap-8 text-center">
                <div>
                  <div className="text-4xl font-bold text-primary mb-2">1000+</div>
                  <div className="text-sm text-muted-foreground">Clientes potenciales</div>
                </div>
                <div>
                  <div className="text-4xl font-bold text-primary mb-2">200+</div>
                  <div className="text-sm text-muted-foreground">Usuarios por cliente</div>
                </div>
                <div>
                  <div className="text-4xl font-bold text-primary mb-2">4</div>
                  <div className="text-sm text-muted-foreground">Modelos de negocio</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 bg-primary text-primary-foreground">
          <div className="container mx-auto px-6 text-center">
            <h2 className="text-3xl font-bold mb-4">Listo para empezar?</h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              Accede a todas las herramientas que necesitas para gestionar las finanzas de tu negocio gastronomico.
            </p>
            <a href="/auth">
              <Button size="lg" variant="secondary" className="px-8" data-testid="button-cta-bottom">
                Ingresar a la Plataforma
              </Button>
            </a>
          </div>
        </section>
      </main>

      <footer className="py-8 border-t">
        <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
          <p>Data Flow 2.0 - Plataforma de Gestion Financiera para Gastronomia</p>
        </div>
      </footer>
    </div>
  );
}
