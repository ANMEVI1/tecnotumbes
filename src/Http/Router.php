<?php

declare(strict_types=1);

namespace App\Http;

use Throwable;

final class Router
{
    /** @var array<int, array{method: string, regex: string, handler: callable}> */
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler): void
    {
        $regex = preg_replace('/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/', '(?P<$1>[^/]+)', $pattern);
        $this->routes[] = [
            'method'  => strtoupper($method),
            'regex'   => '#^' . $regex . '$#',
            'handler' => $handler,
        ];
    }

    public function dispatch(string $method, string $path): void
    {
        $upper = strtoupper($method);
        foreach ($this->routes as $route) {
            if ($route['method'] !== $upper) {
                continue;
            }
            if (preg_match($route['regex'], $path, $matches)) {
                $params = [];
                foreach ($matches as $k => $v) {
                    if (is_string($k)) {
                        $params[$k] = $v;
                    }
                }
                try {
                    ($route['handler'])($params);
                } catch (Throwable $e) {
                    $code = $e->getCode();
                    $status = ($code >= 400 && $code < 600) ? (int) $code : 500;
                    Response::error($e->getMessage(), $status);
                }
                return;
            }
        }

        Response::error('Ruta API no encontrada.', 404);
    }
}
