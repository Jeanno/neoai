# Drives an interactive program on a pseudo-terminal, as a person would:
# each line is typed once the output goes quiet, `@wait N` waits N seconds,
# and the cursor-position queries a line editor makes are answered. Prints
# what the screen showed, escape sequences taken out.
#
#   python3 drive.py <program> <line>...
import os, pty, sys, time, select, re, fcntl, termios, struct
prog, lines = sys.argv[1], sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execv(prog, [prog])
# A terminal of a usual size, 120 by 40.
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
out = b''
def pump(t):
    global out
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try: chunk = os.read(fd, 4096)
            except OSError: return False
            if not chunk: return False
            out += chunk
            # Answer cursor position queries as a terminal does.
            for _ in range(chunk.count(b'\x1b[6n')): os.write(fd, b'\x1b[1;1R')
            end = max(end, time.time() + 0.3)
    return True
pump(1.5)
for l in lines:
    if l.startswith('@wait '):
        pump(float(l.split()[1])); continue
    os.write(fd, l.encode() + b'\r')
    if not pump(1.2): break
pump(1)
try: os.kill(pid, 9)
except: pass
text = re.sub(rb'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\r', b'', out).decode(errors='replace')
print('\n'.join(l for l in text.split('\n') if l.strip()))
