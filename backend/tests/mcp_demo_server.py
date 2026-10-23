"""Tiny stdio MCP server used by the tests and for trying connectors locally."""

import os

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

server = MCPServer("demo-notes", instructions="Arithmetic and a note pad.")


@server.tool(annotations=ToolAnnotations(read_only_hint=True))
def add_numbers(a: float, b: float) -> str:
    """Add two numbers and return the sum."""
    return str(a + b)


@server.tool()
def save_note(text: str) -> str:
    """Save a note to the shared note pad file."""
    path = os.environ.get("DEMO_NOTES", "/tmp/demo-notes.txt")
    with open(path, "a") as f:
        f.write(text + "\n")
    return f"saved to {path}"


if __name__ == "__main__":
    server.run("stdio")
