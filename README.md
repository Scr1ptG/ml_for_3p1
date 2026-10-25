# ML для группы 3П1

Материалы по Machine Learning: квиз для занятий и уроки. Каждый урок лежит в своей папке.

| Что | Ссылка |
|---|---|
| 🎯 Квиз для студентов | https://scr1ptg.github.io/ml_for_3p1/ |
| 🧑‍🏫 Экран преподавателя | https://scr1ptg.github.io/ml_for_3p1/quiz/host.html |

## Уроки
| Папка | Тема | Презентация | Практика в Colab |
|---|---|---|---|
| [`01-video`](01-video) | Видео и OpenCV: картинка → кадр → видео | [slides](https://scr1ptg.github.io/ml_for_3p1/01-video/slides.html) | [открыть в Colab](https://colab.research.google.com/github/Scr1ptG/ml_for_3p1/blob/main/01-video/lesson.ipynb) |

## Устройство репозитория
* `quiz/` — сайт квиза (общий для всех уроков). Формат вопросов — в [quiz/README.md](quiz/README.md).
* `shared/` — движок HTML-презентаций.
* `NN-тема/` — папка урока: `slides.html` (презентация), `lesson.ipynb` (практика), `quiz.json` (вопросы квиза).
* `index.html` в корне перенаправляет на квиз, чтобы студентам вводить короткий адрес.
