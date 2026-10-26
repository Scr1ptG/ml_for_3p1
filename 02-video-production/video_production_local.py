"""Видео-продакшн с веб-камеры: задание LXP «Сделать свой видео-продакшн».

Запуск на своём компьютере (не в Colab):
    pip install opencv-python numpy pillow
    python video_production_local.py

Клавиши в окне видео:
    c — подпись вкл/выкл
    l — логотип вкл/выкл (с анимацией)
    t — время с тенью вкл/выкл
    r — запись в файл вкл/выкл (production.mp4)
    q или Esc — выход

Для сдачи: запишите экран (Win + Alt + R в Windows) и покажите, что происходит при нажатии клавиш.
"""
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

CAPTION = 'Иван Иванов · ML'          # своя подпись
FONT = cv2.FONT_HERSHEY_DUPLEX         # шрифт для времени: попробуйте TRIPLEX, COMPLEX, SCRIPT_SIMPLEX
TEXT_COLOR = (80, 230, 255)            # B, G, R
SHADOW_COLOR = (60, 20, 0)
SHADOW_SHIFT = 2
LOGO_SIZE = 72
CAMERA = 0                             # номер камеры; можно указать путь к видеофайлу


def load_font(size):
    # Шрифт с кириллицей: Arial есть в Windows, DejaVu — в Linux. Иначе встроенный шрифт PIL.
    for name in ['arialbd.ttf', 'arial.ttf', 'DejaVuSans-Bold.ttf']:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


CAPTION_FONT = load_font(22)


def put_text_with_shadow(frame, text, x, y, scale=0.8):
    cv2.putText(frame, text, (x + SHADOW_SHIFT, y + SHADOW_SHIFT), FONT, scale, SHADOW_COLOR, 2, cv2.LINE_AA)
    cv2.putText(frame, text, (x, y), FONT, scale, TEXT_COLOR, 1, cv2.LINE_AA)
    return frame


def put_caption(frame, text, x, y):
    image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(image)
    draw.text((x + 2, y + 2), text, font=CAPTION_FONT, fill=(0, 0, 0))
    draw.text((x, y), text, font=CAPTION_FONT, fill=(255, 255, 255))
    return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)


def make_logo(size=LOGO_SIZE):
    logo = np.zeros((size, size, 4), dtype=np.uint8)
    cv2.circle(logo, (size // 2, size // 2), size // 2 - 2, (230, 120, 20, 255), -1)
    cv2.circle(logo, (size // 2, size // 2), size // 2 - 2, (255, 255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(logo, 'ML', (size // 2 - 20, size // 2 + 10), cv2.FONT_HERSHEY_DUPLEX, 1.0,
                (255, 255, 255, 255), 2, cv2.LINE_AA)
    return logo


def overlay(frame, logo, x, y, opacity=1.0):
    h, w = logo.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, frame.shape[1]), min(y + h, frame.shape[0])
    if x0 >= x1 or y0 >= y1:
        return frame
    part = logo[y0 - y:y1 - y, x0 - x:x1 - x]
    alpha = part[:, :, 3:4].astype(np.float32) / 255 * opacity
    region = frame[y0:y1, x0:x1].astype(np.float32)
    frame[y0:y1, x0:x1] = (alpha * part[:, :, :3] + (1 - alpha) * region).astype(np.uint8)
    return frame


def produce(frame, t, state, logo):
    h, w = frame.shape[:2]
    if state['logo']:
        since = t - state['logo_on_at']
        slide = min(1.0, since / 0.6)                          # въезжает справа за 0.6 с
        x = int(w - 8 - LOGO_SIZE * slide)
        pulse = 0.8 + 0.2 * np.sin(2 * np.pi * t)
        frame = overlay(frame, logo, x, 8, opacity=pulse)
    if state['caption']:
        frame = put_caption(frame, CAPTION, 12, h - 40)
    if state['time']:
        frame = put_text_with_shadow(frame, time.strftime('%H:%M:%S'), 12, 32)
    if state['recording'] and int(t * 2) % 2 == 0:             # мигающая точка записи
        cv2.circle(frame, (w - 20, h - 20), 8, (0, 0, 255), -1)
    return frame


def main():
    cap = cv2.VideoCapture(CAMERA)
    if not cap.isOpened():
        raise SystemExit('Камера не открылась. Попробуйте CAMERA = 1 или путь к видеофайлу.')
    fps = cap.get(cv2.CAP_PROP_FPS)
    fps = fps if 1 <= fps <= 120 else 30.0
    logo = make_logo()
    state = {'caption': False, 'logo': False, 'time': True, 'recording': False, 'logo_on_at': 0.0}
    writer = None
    start = time.perf_counter()
    print(__doc__)

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = time.perf_counter() - start
        frame = produce(frame, t, state, logo)
        if writer is not None:
            writer.write(frame)
        cv2.imshow('Video production (c, l, t, r, q)', frame)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), 27):
            break
        if key == ord('c'):
            state['caption'] = not state['caption']
        if key == ord('t'):
            state['time'] = not state['time']
        if key == ord('l'):
            state['logo'] = not state['logo']
            state['logo_on_at'] = t
        if key == ord('r'):
            state['recording'] = not state['recording']
            if state['recording']:
                h, w = frame.shape[:2]
                writer = cv2.VideoWriter('production.mp4', cv2.VideoWriter_fourcc(*'mp4v'), fps, (w, h))
                print('Запись началась: production.mp4')
            else:
                writer.release()
                writer = None
                print('Запись сохранена: production.mp4')

    if writer is not None:
        writer.release()
    cap.release()
    cv2.destroyAllWindows()


if __name__ == '__main__':
    main()
