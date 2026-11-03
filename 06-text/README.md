# Текст, тема 1. Как машина читает твиты

LXP: «Текст в представлении машины. Методы работы с текстом. Bag of words».

| Что | Ссылка |
|---|---|
| Презентация, пара 1: токены, one-hot, мешок слов, TF-IDF, word2vec | [slides.html](https://scr1ptg.github.io/ml_for_3p1/06-text/slides.html) |
| Презентация, пара 2: векторизация, стоп-слова, стемминг, лемматизация, n-граммы | [slides2.html](https://scr1ptg.github.io/ml_for_3p1/06-text/slides2.html) |
| Практика: токены, словарь, one-hot, мешок слов, TF-IDF своими руками, классификатор твитов (21 задание) | [lesson.ipynb в Colab](https://colab.research.google.com/github/Scr1ptG/ml_for_3p1/blob/main/06-text/lesson.ipynb) |
| Квиз (28 вопросов, «Текст» в списке ведущего): + стоп-слова, стемминг, лемматизация, эмбеддинги | `quiz.json` |

Данные: `data/tweets.csv` — 10 000 русских твитов (5 000 позитивных, 5 000 негативных) из корпуса RuTweetCorp (Ю. Рубцова), выборка [AlexSham/RuTweetCorpMerged](https://huggingface.co/datasets/AlexSham/RuTweetCorpMerged). Метки ставились автоматически по смайликам; смайлики, упоминания и ссылки удалены.
