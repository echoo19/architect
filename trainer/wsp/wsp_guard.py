"""The guard every Architect WSP worker process runs under (decision 109).

It is installed after the worker has imported its tensor libraries and opened the base checkpoint,
and it can't be removed: CPython keeps audit hooks for the life of the process. It refuses network
access, new processes, native calls through ctypes, imports of modules that reach those, and file
access outside the folders the runner named: the base checkpoint and the session's read folders
for reading, the session's output and scratch folders for writing. It also stops the process when
it holds more memory than its cap.

This is a guard inside the process, not an operating-system sandbox: it raises the bar for a
program Astra wrote, and the runner checks everything the program hands back. Decision 109 says
what it does not cover.
"""

from __future__ import annotations

import os
import sys
import threading
import time

DENIED_MODULES = frozenset(
    {
        "socket",
        "_socket",
        "ssl",
        "_ssl",
        "http",
        "urllib",
        "urllib3",
        "requests",
        "httpx",
        "aiohttp",
        "ftplib",
        "smtplib",
        "imaplib",
        "poplib",
        "telnetlib",
        "xmlrpc",
        "subprocess",
        "_posixsubprocess",
        "multiprocessing",
        "concurrent",
        "asyncio",
        "select",
        "selectors",
        "ctypes",
        "_ctypes",
        "cffi",
        "winreg",
        "_winapi",
        "msvcrt",
        "pty",
        "webbrowser",
        "huggingface_hub",
        "safetensors",
    }
)

DENIED_EVENTS = (
    "socket.",
    "subprocess.",
    "os.system",
    "os.exec",
    "os.posix_spawn",
    "os.spawn",
    "os.fork",
    "os.forkpty",
    "os.kill",
    "os.killpg",
    "os.startfile",
    "os.putenv",
    "os.unsetenv",
    "ctypes.",
    "winreg.",
    "_winapi.",
    "webbrowser.",
    "urllib.",
    "http.",
    "ftplib.",
    "smtplib.",
    "imaplib.",
    "poplib.",
    "telnetlib.",
    "gc.get_objects",
    "gc.get_referrers",
    "gc.get_referents",
    "sys._getframe",
    "sys._current_frames",
    "sys.addaudithook",
    "sys.setprofile",
    "sys.settrace",
    "cpython._PySys_ClearAuditHooks",
    "_thread.start_new_thread",
    "mmap.",
)

WRITE_EVENTS = frozenset(
    {
        "os.remove",
        "os.rename",
        "os.rmdir",
        "os.mkdir",
        "os.chmod",
        "os.chown",
        "os.link",
        "os.symlink",
        "os.truncate",
        "os.utime",
        "shutil.rmtree",
        "shutil.move",
        "shutil.copyfile",
        "shutil.copytree",
    }
)

LIST_EVENTS = frozenset({"os.listdir", "os.scandir", "glob.glob", "os.chdir"})

PROTECTED_ATTRS = frozenset(
    {"__code__", "__defaults__", "__kwdefaults__", "__closure__", "__globals__", "audit_hook"}
)


class GuardRefusal(PermissionError):
    pass


def _norm(path: object) -> str | None:
    if isinstance(path, int):
        return None
    if isinstance(path, bytes):
        path = path.decode(errors="replace")
    if not isinstance(path, (str, os.PathLike)):
        return None
    return os.path.normcase(os.path.realpath(os.fspath(path)))


def _under(path: str, roots: tuple[str, ...]) -> bool:
    return any(path == root or path.startswith(root + os.sep) for root in roots)


def _mode_writes(mode: object, flags: object) -> bool:
    if isinstance(mode, str) and any(ch in mode for ch in "wax+"):
        return True
    if isinstance(flags, int):
        return bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC))
    return False


def _rss_bytes() -> int:
    """This process's resident memory, without psutil."""
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = Counters()
        counters.cb = ctypes.sizeof(Counters)
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb)
        return int(counters.PagefileUsage)
    with open("/proc/self/statm", "rb") as fh:
        return int(fh.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")


def start_memory_watch(limit_bytes: int) -> int:
    """Stops the process when it holds more than `limit_bytes`. Returns the watcher's thread id."""
    ready = threading.Event()
    ident: list[int] = []

    def watch() -> None:
        ident.append(threading.get_ident())
        ready.set()
        while True:
            if _rss_bytes() > limit_bytes:
                sys.stderr.write(f"WSP_MEMORY_LIMIT {limit_bytes}\n")
                sys.stderr.flush()
                os._exit(137)
            time.sleep(0.25)

    threading.Thread(target=watch, name="wsp-memory", daemon=True).start()
    ready.wait()
    return ident[0]


def install(read_roots: list[str], write_roots: list[str], watcher_thread: int | None) -> None:
    """Installs the guard for the rest of the process's life."""
    writes = tuple(_norm(root) for root in write_roots if _norm(root))
    reads = tuple(
        _norm(root)
        for root in [
            *read_roots,
            *write_roots,
            sys.prefix,
            sys.base_prefix,
            sys.exec_prefix,
            *[p for p in sys.path if p],
        ]
        if _norm(root)
    )
    exempt = watcher_thread
    # A module already imported is handed out again without an audit event, so the denied ones
    # are dropped from the cache: an import then loads it afresh, and the hook refuses that. Code
    # that imported them before keeps its own references.
    for name in [m for m in sys.modules if m.split(".")[0] in DENIED_MODULES]:
        del sys.modules[name]

    def audit_hook(event: str, args: tuple) -> None:
        if exempt is not None and threading.get_ident() == exempt:
            return
        if event == "import":
            top = str(args[0]).split(".")[0]
            if top in DENIED_MODULES:
                raise GuardRefusal(f"importing {args[0]} is not allowed here")
            return
        if event == "open":
            path = _norm(args[0])
            if path is None:
                return
            mode = args[1] if len(args) > 1 else "r"
            flags = args[2] if len(args) > 2 else 0
            if _mode_writes(mode, flags):
                if not _under(path, writes):
                    raise GuardRefusal(f"writing {args[0]} is not allowed; write to scratch")
            elif not _under(path, reads):
                raise GuardRefusal(f"reading {args[0]} is not allowed")
            return
        if event in WRITE_EVENTS:
            for item in args:
                path = _norm(item)
                if path is not None and not _under(path, writes):
                    raise GuardRefusal(f"{event} outside the scratch folder is not allowed")
            return
        if event in LIST_EVENTS:
            path = _norm(args[0]) if args else None
            if path is not None and not _under(path, reads):
                raise GuardRefusal(f"{event} of {args[0]} is not allowed")
            return
        if event == "object.__setattr__" and len(args) > 1 and args[1] in PROTECTED_ATTRS:
            raise GuardRefusal(f"setting {args[1]} is not allowed")
        if event.startswith(DENIED_EVENTS):
            raise GuardRefusal(f"{event} is not allowed here")

    sys.addaudithook(audit_hook)


NETWORK_EVENTS = ("socket.", "subprocess.", "os.system", "os.exec", "os.posix_spawn", "os.spawn",
                  "os.startfile", "webbrowser.", "urllib.", "http.")


def install_network_only() -> None:
    """For the evaluator, which runs only the runner's code: no network and no new processes."""

    def audit_hook(event: str, args: tuple) -> None:
        if event.startswith(NETWORK_EVENTS):
            raise GuardRefusal(f"{event} is not allowed here")

    sys.addaudithook(audit_hook)
