# Carpeta para tu modelo 3D exportado desde Blender (.glb)

Coloca aquí tu archivo:
`campus.glb` (o el nombre que configures en `MODEL_GLB_URL` en tu `.env`)

### Características soportadas:
1. Formato: **glTF 2.0 Binary (`.glb`)**
2. Three.js `GLTFLoader` lo detectará y cargará automáticamente en el visor 3D sustituyendo la maqueta procedural.
3. Si tus objetos en Blender tienen nombres reconocibles (`PAB_`, `LAB_`, `TALLER_`, etc.), la web los asociará dinámicamente con los eventos de clic, resaltado e información.
4. Si subes tu repositorio a GitHub, este archivo `.glb` se servirá gratis desde la red global ultra rápida de **jsDelivr CDN** sin gastar ancho de banda de InfinityFree.
