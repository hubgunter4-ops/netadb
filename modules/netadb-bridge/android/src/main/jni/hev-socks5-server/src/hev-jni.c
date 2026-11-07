/*
 ============================================================================
 Name        : hev-jni.c
 Author      : hev <r@hev.cc>
 Copyright   : Copyright (c) 2019 - 2024 hev
 Description : Jave Native Interface
 ============================================================================
 */

#ifdef ANDROID

#include <jni.h>
#include <pthread.h>
#include <stdatomic.h>

#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <string.h>

#include "hev-main.h"

#include "hev-jni.h"
#include "netadb-event.h"

/* clang-format off */
#ifndef PKGNAME
#define PKGNAME hev/socks5
#endif
#ifndef CLSNAME
#define CLSNAME Socks5Service
#endif
/* clang-format on */

#define STR(s) STR_ARG (s)
#define STR_ARG(c) #c
#define N_ELEMENTS(arr) (sizeof (arr) / sizeof ((arr)[0]))

typedef struct _ThreadData ThreadData;

struct _ThreadData
{
    char *path;
};

static atomic_int is_running;
static int thread_joinable;
static JavaVM *java_vm;
static pthread_t work_thread;
static pthread_mutex_t mutex;
static pthread_key_t current_jni_env;
static jclass callback_class;
static jmethodID callback_method;

static jboolean native_start_service (JNIEnv *env, jobject thiz,
                                      jstring conig_path);
static jboolean native_stop_service (JNIEnv *env, jobject thiz);
static jboolean native_is_running (JNIEnv *env, jobject thiz);

static JNINativeMethod native_methods[] = {
    { "Socks5StartService", "(Ljava/lang/String;)Z",
      (void *)native_start_service },
    { "Socks5StopService", "()Z", (void *)native_stop_service },
    { "Socks5IsRunning", "()Z", (void *)native_is_running },
};

static void
detach_current_thread (void *env)
{
    (*java_vm)->DetachCurrentThread (java_vm);
}

jint
JNI_OnLoad (JavaVM *vm, void *reserved)
{
    JNIEnv *env = NULL;
    jclass klass;
    jint res;

    java_vm = vm;
    res = (*vm)->GetEnv (vm, (void **)&env, JNI_VERSION_1_4);
    if (res != JNI_OK)
        return JNI_ERR;

    klass = (*env)->FindClass (env, STR (PKGNAME) "/" STR (CLSNAME));
    if (!klass)
        return JNI_ERR;
    res = (*env)->RegisterNatives (env, klass, native_methods,
                                   N_ELEMENTS (native_methods));
    if (res >= 0) {
        callback_method = (*env)->GetStaticMethodID (
            env, klass, "onConnectionEvent",
            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;J)V");
        callback_class = (*env)->NewGlobalRef (env, klass);
        if (!callback_method || !callback_class)
            res = JNI_ERR;
    }
    (*env)->DeleteLocalRef (env, klass);
    if (res < 0)
        return JNI_ERR;

    pthread_key_create (&current_jni_env, detach_current_thread);
    pthread_mutex_init (&mutex, NULL);

    return JNI_VERSION_1_4;
}

static void *
thread_handler (void *data)
{
    ThreadData *tdata = data;

    hev_socks5_server_main_from_file (tdata->path);

    atomic_store_explicit (&is_running, 0, memory_order_release);

    free (tdata->path);
    free (tdata);

    return NULL;
}

static jboolean
native_start_service (JNIEnv *env, jobject thiz, jstring config_path)
{
    const jbyte *bytes;
    ThreadData *tdata;
    int res;
    jboolean result = JNI_FALSE;

    pthread_mutex_lock (&mutex);

    if (atomic_load_explicit (&is_running, memory_order_acquire))
        goto exit;

    if (thread_joinable) {
        pthread_join (work_thread, NULL);
        thread_joinable = 0;
    }

    tdata = malloc (sizeof (ThreadData));
    if (!tdata)
        goto exit;

    bytes = (const jbyte *)(*env)->GetStringUTFChars (env, config_path, NULL);
    if (!bytes) {
        free (tdata);
        goto exit;
    }
    tdata->path = strdup ((const char *)bytes);
    (*env)->ReleaseStringUTFChars (env, config_path, (const char *)bytes);
    if (!tdata->path) {
        free (tdata);
        goto exit;
    }

    atomic_store_explicit (&is_running, 1, memory_order_release);
    res = pthread_create (&work_thread, NULL, thread_handler, tdata);
    if (res != 0) {
        atomic_store_explicit (&is_running, 0, memory_order_release);
        free (tdata->path);
        free (tdata);
        goto exit;
    }

    thread_joinable = 1;
    result = JNI_TRUE;
exit:
    pthread_mutex_unlock (&mutex);
    return result;
}

static jboolean
native_stop_service (JNIEnv *env, jobject thiz)
{
    int res = 0;

    pthread_mutex_lock (&mutex);

    if (!thread_joinable)
        goto exit;

    if (atomic_load_explicit (&is_running, memory_order_acquire))
        hev_socks5_server_quit ();
    res = pthread_join (work_thread, NULL);

    thread_joinable = 0;
    atomic_store_explicit (&is_running, 0, memory_order_release);
exit:
    pthread_mutex_unlock (&mutex);
    return res == 0 ? JNI_TRUE : JNI_FALSE;
}

static jboolean
native_is_running (JNIEnv *env, jobject thiz)
{
    return atomic_load_explicit (&is_running, memory_order_acquire) ? JNI_TRUE :
                                                                      JNI_FALSE;
}

void
netadb_connection_event (const char *protocol, const char *endpoint,
                         const char *direction, long long bytes)
{
    JNIEnv *env = NULL;
    jstring jprotocol, jendpoint, jdirection;
    jint status;
    int attached = 0;

    if (!java_vm || !callback_class || !callback_method || !protocol ||
        !endpoint || !direction)
        return;

    status = (*java_vm)->GetEnv (java_vm, (void **)&env, JNI_VERSION_1_4);
    if (status == JNI_EDETACHED) {
        if ((*java_vm)->AttachCurrentThread (java_vm, &env, NULL) != JNI_OK)
            return;
        attached = 1;
    } else if (status != JNI_OK) {
        return;
    }

    jprotocol = (*env)->NewStringUTF (env, protocol);
    jendpoint = (*env)->NewStringUTF (env, endpoint);
    jdirection = (*env)->NewStringUTF (env, direction);
    if (jprotocol && jendpoint && jdirection) {
        (*env)->CallStaticVoidMethod (env, callback_class, callback_method,
                                      jprotocol, jendpoint, jdirection,
                                      (jlong)bytes);
        if ((*env)->ExceptionCheck (env))
            (*env)->ExceptionClear (env);
    }
    if (jprotocol)
        (*env)->DeleteLocalRef (env, jprotocol);
    if (jendpoint)
        (*env)->DeleteLocalRef (env, jendpoint);
    if (jdirection)
        (*env)->DeleteLocalRef (env, jdirection);
    if (attached)
        (*java_vm)->DetachCurrentThread (java_vm);
}

#endif /* ANDROID */
