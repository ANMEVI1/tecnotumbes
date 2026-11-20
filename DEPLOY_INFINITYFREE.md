# Guía de Despliegue en InfinityFree + GitHub + jsDelivr CDN

Esta arquitectura permite que tu web en **InfinityFree** funcione a **Costo $0**, con **máxima velocidad** y **sin agotar los límites del hosting gratuito** (límites de CPU, inodes y ancho de banda diario).

---

## 🏗️ Cómo funciona la arquitectura

1. **InfinityFree (Solo PHP + MySQL):**
   * Aloja únicamente el backend MVC ligero (archivos `.php`, `.htaccess`, `.env`).
   * No almacena archivos pesados ni dependencias gigantescas (sin carpeta `vendor/` pesada).
   * Solo procesa las peticiones de base de datos y entrega el HTML inicial en pocos milisegundos.

2. **GitHub + jsDelivr CDN (Frontend y 3D):**
   * Tu repositorio público de GitHub almacena el modelo 3D `.glb`, CSS, JS y módulos Three.js.
   * **jsDelivr** entrega automáticamente cada archivo estático a través de su CDN global con caché rápida:
     `https://cdn.jsdelivr.net/gh/TU_USUARIO/TU_REPO@main/public/assets/...`
   * **Resultado:** InfinityFree se ahorra el 98% del tráfico y ancho de banda.

---

## 🚀 Pasos para Publicar

### 1. Subir tu proyecto a un repositorio público en GitHub
Crea tu repositorio en GitHub y sube el proyecto:
```bash
git init
git add .
git commit -m "tecno-tumbes: arquitectura PHP MVC + Three.js"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/tecno-tumbes.git
git push -u origin main
```

### 2. Crear tu Base de Datos en InfinityFree
1. Entra a tu panel de **Control de InfinityFree (cPanel)**.
2. Ve a **MySQL Databases** y crea una base de datos (ejemplo: `epiz_12345678_tecno_tumbes`).
3. Abre **phpMyAdmin** en InfinityFree y pulsa en la pestaña **Importar**.
4. Selecciona el archivo `database/schema.sql` y luego ejecuta el contenido de las inserciones de `database/seed.php` (o exporta la base de datos local `db_tecno_tumbes` con phpMyAdmin/HeidiSQL e impórtala).

### 3. Configurar `.env` en InfinityFree
En tu servidor de InfinityFree (dentro de `/htdocs/`), crea o edita tu `.env`:

```ini
APP_ENV=production
APP_URL=https://tu-dominio.infinityfreeapp.com
DB_HOST=sql123.infinityfree.com
DB_PORT=3306
DB_NAME=epiz_12345678_tecno_tumbes
DB_USER=epiz_12345678
DB_PASS=tu_password_de_infinityfree
APP_KEY=6d1a91a5e70c03e97d0662b9d50e36f75ccc0be407a644c5d24cc98befc0dd51
TI_SESSION_TTL=900

# Tu CDN de jsDelivr con tu usuario y repo de GitHub:
CDN_URL=https://cdn.jsdelivr.net/gh/TU_USUARIO/tecno-tumbes@main/public
MODEL_GLB_URL=/assets/models/campus.glb
```

*(En local en tu computadora, deja `CDN_URL=` vacío para que siga trabajando 100% con los archivos locales de tu disco).*

---

## 🎨 Cómo vincular tu diseño 3D de Blender (`.glb`)

1. Exporta tu diseño desde Blender en formato **`glTF 2.0 Binary (.glb)`**.
2. Guárdalo como:
   `public/assets/models/campus.glb`
3. **Pruébalo al instante:**
   * Abre `http://127.0.0.1:8085` en tu navegador.
   * Puedes recargar la página o **arrastrar tu archivo `.glb` directamente con el ratón sobre el mapa 3D** en la pantalla para previsualizarlo inmediatamente.
4. Cuando hagas `git push` a GitHub, jsDelivr lo convertirá en tu modelo CDN en la nube automáticamente.

---

## 🔄 Despliegue Automático con GitHub Actions (Opcional)

Si deseas que cada `git push` actualice automáticamente InfinityFree y limpie la caché de jsDelivr:
1. En tu repositorio de GitHub, ve a **Settings > Secrets and variables > Actions**.
2. Agrega estos 3 secretos (los datos FTP te los da InfinityFree en los detalles de tu cuenta):
   * `FTP_SERVER`: tu servidor FTP (ej: `ftpupload.net`).
   * `FTP_USERNAME`: tu usuario FTP (ej: `epiz_12345678`).
   * `FTP_PASSWORD`: tu contraseña FTP.
3. El archivo `.github/workflows/deploy.yml` que ya dejamos configurado subirá el código PHP y purgará la caché de jsDelivr en cada cambio.
